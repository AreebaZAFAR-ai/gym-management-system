-- Rules Drizzle cannot express in schema.ts. Reviewed by hand.
-- Creates functions, triggers and one foreign key only; changes no data.

-- 1. Payments are append-only --------------------------------------------
-- §9 payments: "Never edited or deleted; corrections are new rows."
-- §11: "Payments are append-only."
-- UPDATE, DELETE and TRUNCATE are rejected for every database user, including the API.

CREATE FUNCTION reject_append_only_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payments_append_only
  BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
CREATE TRIGGER payments_no_truncate
  BEFORE TRUNCATE ON payments
  FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint

-- 2. Registration requires a membership payment ---------------------------
-- A member may not be registered without a membership payment. Checked when
-- the registering transaction commits, so the member row and its first
-- payment are saved together (the payment references the member).

CREATE FUNCTION check_member_has_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM payments WHERE gym_id = NEW.gym_id AND member_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'members: a member must be registered with a membership payment'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER members_require_payment
  AFTER INSERT ON members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_member_has_payment();
--> statement-breakpoint

-- 3. Exercise names are unique within each gym, ignoring case -------------
-- Same-gym and built-in duplicates are blocked by unique indexes in 0000.
-- A gym's exercises include the built-ins, so this trigger also blocks a gym
-- exercise that reuses a built-in name, and a new built-in that reuses a name
-- a gym already has.

CREATE FUNCTION check_exercise_name_unique() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM exercises e
     WHERE lower(e.name) = lower(NEW.name)
       AND e.id <> NEW.id
       AND (e.gym_id IS NULL) <> (NEW.gym_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'exercises: an exercise named "%" already exists for this gym', NEW.name
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER exercises_name_unique
  BEFORE INSERT OR UPDATE OF name, gym_id ON exercises
  FOR EACH ROW EXECUTE FUNCTION check_exercise_name_unique();
--> statement-breakpoint

-- 4. Gym isolation for workouts and plans --------------------------------
-- §9: every table except built-in exercises carries gym_id.
-- §11: staff of gym A cannot see or change anything in gym B.

-- A session's plan must be a plan of the same gym. When a plan is deleted
-- (§6 "Delete", §10 DELETE trainer/plans/:id) only plan_id is cleared, so the
-- member's logged workout history is kept (PostgreSQL 15+ column list).
ALTER TABLE exercise_sessions
  ADD CONSTRAINT exercise_sessions_plan_fk
  FOREIGN KEY (gym_id, plan_id) REFERENCES trainer_plans (gym_id, id)
  ON DELETE SET NULL (plan_id);
--> statement-breakpoint

-- Exercises used by a session must be built-in (gym_id null) or the same gym's.
CREATE FUNCTION check_session_exercise_gym() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM exercises
     WHERE id = NEW.exercise_id AND gym_id IS NOT NULL AND gym_id <> NEW.gym_id
  ) THEN
    RAISE EXCEPTION 'exercise_sessions: exercise belongs to another gym'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER exercise_sessions_exercise_gym
  BEFORE INSERT OR UPDATE OF exercise_id, gym_id ON exercise_sessions
  FOR EACH ROW EXECUTE FUNCTION check_session_exercise_gym();
--> statement-breakpoint

-- Exercises named in a trainer plan's items must be built-in or the same gym's.
CREATE FUNCTION check_plan_exercises_gym() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  bad text;
BEGIN
  SELECT item ->> 'exerciseId' INTO bad
    FROM jsonb_array_elements(NEW.items) AS item
   WHERE NOT EXISTS (
     SELECT 1 FROM exercises e
      WHERE e.id = item ->> 'exerciseId'
        AND (e.gym_id IS NULL OR e.gym_id = NEW.gym_id)
   )
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'trainer_plans: exercise "%" is not available in this gym', bad
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trainer_plans_exercises_gym
  BEFORE INSERT OR UPDATE OF items, gym_id ON trainer_plans
  FOR EACH ROW EXECUTE FUNCTION check_plan_exercises_gym();
