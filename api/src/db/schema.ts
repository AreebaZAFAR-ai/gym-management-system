/**
 * Database schema, following the requirements PDF strictly.
 *
 * Tables: the 15 tables of §9, plus `due_date_changes` because §11 requires
 * "Owner-only due-date edits are logged".
 *
 * Gym isolation (§3 "every record tagged with its gym", §9 "every table except
 * built-in exercises carries gym_id", §11 "Staff of gym A cannot see or change
 * anything in gym B"): every reference to another gym-owned row is a composite
 * foreign key (gym_id, id), so a row can never point at another gym's data.
 *
 * Rules Drizzle cannot express live in drizzle/0001_integrity_rules.sql:
 *   - payments are append-only (§9 "Never edited or deleted", §11)
 *   - a new member must be saved together with a membership payment
 *   - a gym's own exercise may not reuse a built-in exercise name (case-insensitive)
 *   - exercise_sessions.plan_id -> trainer_plans(gym_id, id) ON DELETE SET NULL (plan_id)
 *   - exercises used by sessions and trainer plans must be built-in or the same gym's
 *
 * Migrations are generated from this file with `npm run db:generate` and
 * reviewed before `npm run db:migrate`. Never use `drizzle-kit push`.
 */
import type {
  CheckinSource,
  Equipment,
  FreezeReason,
  Gender,
  Goal,
  MuscleGroup,
  PaymentMethod,
  PlanItem,
  RequestStatus,
  Role,
  SetEntry,
  TrainerSession,
  WhatsAppKind,
  WhatsAppStatus,
} from '@gym/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------- Enums (values must match the unions in @gym/shared, §10) ----------

/** Compile-time check that a value list covers every member of a shared union. */
type Covers<U, T extends readonly unknown[]> = [Exclude<U, T[number]>] extends [never] ? true : false;

const ROLES = ['member', 'reception', 'trainer', 'owner'] as const satisfies readonly Role[];
const PAYMENT_METHODS = ['cash', 'jazzcash', 'easypaisa', 'bank'] as const satisfies readonly PaymentMethod[];
const CHECKIN_SOURCES = ['qr', 'manual', 'fingerprint'] as const satisfies readonly CheckinSource[];
const GOALS = ['strength', 'muscle', 'fat_loss', 'fitness'] as const satisfies readonly Goal[];
const GENDERS = ['male', 'female', 'other'] as const satisfies readonly Gender[];
const FREEZE_REASONS = ['travel', 'illness', 'other'] as const satisfies readonly FreezeReason[];
const REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const satisfies readonly RequestStatus[];
const EQUIPMENT = ['bar', 'db', 'machine', 'body'] as const satisfies readonly Equipment[];
const MUSCLES = ['chest', 'back', 'legs', 'shoulders', 'arms', 'core'] as const satisfies readonly MuscleGroup[];
const SESSION_KINDS = ['pt', 'class'] as const satisfies readonly TrainerSession['kind'][];
const WHATSAPP_KINDS = ['receipt', 'reminder', 'welcome', 'announcement', 'other'] as const satisfies readonly WhatsAppKind[];
const WHATSAPP_STATUSES = ['queued', 'sent', 'failed'] as const satisfies readonly WhatsAppStatus[];

true satisfies Covers<Role, typeof ROLES>;
true satisfies Covers<PaymentMethod, typeof PAYMENT_METHODS>;
true satisfies Covers<CheckinSource, typeof CHECKIN_SOURCES>;
true satisfies Covers<Goal, typeof GOALS>;
true satisfies Covers<Gender, typeof GENDERS>;
true satisfies Covers<FreezeReason, typeof FREEZE_REASONS>;
true satisfies Covers<RequestStatus, typeof REQUEST_STATUSES>;
true satisfies Covers<Equipment, typeof EQUIPMENT>;
true satisfies Covers<MuscleGroup, typeof MUSCLES>;
true satisfies Covers<TrainerSession['kind'], typeof SESSION_KINDS>;
true satisfies Covers<WhatsAppKind, typeof WHATSAPP_KINDS>;
true satisfies Covers<WhatsAppStatus, typeof WHATSAPP_STATUSES>;

export const roleEnum = pgEnum('role', ROLES);
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);
export const checkinSourceEnum = pgEnum('checkin_source', CHECKIN_SOURCES);
export const goalEnum = pgEnum('goal', GOALS);
export const genderEnum = pgEnum('gender', GENDERS);
export const freezeReasonEnum = pgEnum('freeze_reason', FREEZE_REASONS);
export const requestStatusEnum = pgEnum('request_status', REQUEST_STATUSES);
export const equipmentEnum = pgEnum('equipment', EQUIPMENT);
export const muscleEnum = pgEnum('muscle', MUSCLES);
export const sessionKindEnum = pgEnum('session_kind', SESSION_KINDS);
export const whatsappKindEnum = pgEnum('whatsapp_kind', WHATSAPP_KINDS);
export const whatsappStatusEnum = pgEnum('whatsapp_status', WHATSAPP_STATUSES);

// ---------- Column helpers ----------

/** §8: all times stored in UTC (timestamptz); business dates in Pakistan time (`date`). */
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
/** Pakistan business date, read and written as "YYYY-MM-DD" (matches @gym/shared). */
const day = (name: string) => date(name, { mode: 'string' });
const gymRef = () =>
  text('gym_id')
    .notNull()
    .references(() => gyms.id);

// ---------- gyms ----------

export const gyms = pgTable('gyms', {
  /** Slug, e.g. "ironhouse". */
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  short: text('short').notNull(),
  city: text('city').notNull(),
  primaryColor: text('primary_color').notNull(),
  memberPrefix: text('member_prefix').notNull(),
  /**
   * Last running number issued for member IDs (§7 Registration: "gym prefix +
   * running number ... never reused").
   */
  lastMemberNumber: integer('last_member_number').notNull().default(0),
  payToLabel: text('pay_to_label').notNull().default(''),
  payToNumber: text('pay_to_number').notNull().default(''),
  payToTitle: text('pay_to_title').notNull().default(''),
  receptionWhatsapp: text('reception_whatsapp').notNull().default(''),
  /** Never sent to any client (§9); never leaves the server (§7). */
  checkinSecret: text('checkin_secret').notNull(),
  /** §7: gym setting, default 3. */
  graceDays: smallint('grace_days').notNull().default(3),
  /** §6 Settings: thumbprint machine address. */
  deviceAddress: text('device_address'),
  /** §6 Settings: device key; §10 sent by the machine as x-device-key. */
  deviceKey: text('device_key'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------- users ----------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: gymRef(),
    /** 10 digits (§9); "10 digits starting with 3" (§4.1). */
    phone: char('phone', { length: 10 }).notNull(),
    name: text('name').notNull(),
    role: roleEnum('role').notNull(),
    /** bcrypt, cost 10+ (§11). */
    passwordHash: text('password_hash').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('users_gym_phone_unique').on(t.gymId, t.phone),
    unique('users_gym_id_unique').on(t.gymId, t.id),
    index('users_gym_role_idx').on(t.gymId, t.role),
    check('users_phone_format', sql.raw(`phone ~ '^3[0-9]{9}$'`)),
  ],
);

// ---------- plans (fee plans) ----------

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: gymRef(),
    name: text('name').notNull(),
    /** e.g. "Ladies timings". */
    timing: text('timing'),
    feePkr: integer('fee_pkr').notNull(),
    months: smallint('months').notNull(),
    /** §6: Hide/Show. Hidden plans stay on existing members. */
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('plans_gym_id_unique').on(t.gymId, t.id)],
);

// ---------- members ----------

export const members = pgTable(
  'members',
  {
    userId: uuid('user_id').primaryKey(),
    gymId: gymRef(),
    /** e.g. "IH-0412". */
    code: text('code').notNull(),
    planId: uuid('plan_id').notNull(),
    trainerId: uuid('trainer_id'),
    joinedOn: day('joined_on').notNull(),
    /**
     * Required. Registration needs a membership payment (final clarification 2),
     * and the due date comes from that payment by the §7 rule. A deferred trigger
     * in 0001_integrity_rules.sql rejects a new member saved without a payment.
     */
    dueOn: day('due_on').notNull(),
    frozenUntil: day('frozen_until'),
    goal: goalEnum('goal'),
    gender: genderEnum('gender'),
    emergencyContact: text('emergency_contact'),
    /**
     * ID sent by the gym's external fingerprint device (§10 devices/:gymId/fingerprint).
     * Unique within the gym; the same ID may exist in another gym. No fingerprint
     * images or biometric templates are stored.
     */
    fingerprintId: text('fingerprint_id'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: 'members_user_fk', columns: [t.gymId, t.userId], foreignColumns: [users.gymId, users.id] }),
    foreignKey({ name: 'members_plan_fk', columns: [t.gymId, t.planId], foreignColumns: [plans.gymId, plans.id] }),
    foreignKey({ name: 'members_trainer_fk', columns: [t.gymId, t.trainerId], foreignColumns: [users.gymId, users.id] }),
    unique('members_gym_code_unique').on(t.gymId, t.code),
    unique('members_gym_user_unique').on(t.gymId, t.userId),
    // One fingerprint ID per member within a gym. Members without one (null) are not affected.
    unique('members_gym_fingerprint_unique').on(t.gymId, t.fingerprintId),
    index('members_gym_due_on_idx').on(t.gymId, t.dueOn),
    index('members_gym_trainer_idx').on(t.gymId, t.trainerId),
  ],
);

// ---------- payment_proofs ----------

export const paymentProofs = pgTable(
  'payment_proofs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: gymRef(),
    memberId: uuid('member_id').notNull(),
    /** §11: not a public URL in production (served through signed links). */
    imageUrl: text('image_url').notNull(),
    status: requestStatusEnum('status').notNull().default('pending'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: 'payment_proofs_member_fk', columns: [t.gymId, t.memberId], foreignColumns: [members.gymId, members.userId] }),
    unique('payment_proofs_gym_id_unique').on(t.gymId, t.id),
    index('payment_proofs_gym_status_idx').on(t.gymId, t.status, t.createdAt),
  ],
);

// ---------- payments (append-only: triggers in 0001_integrity_rules.sql) ----------

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: gymRef(),
    memberId: uuid('member_id').notNull(),
    amountPkr: integer('amount_pkr').notNull(),
    method: paymentMethodEnum('method').notNull(),
    /** §7: transaction ID optional. */
    txnId: text('txn_id'),
    periodFrom: day('period_from').notNull(),
    periodTo: day('period_to').notNull(),
    /** §11: every payment stores who recorded it. */
    recordedBy: uuid('recorded_by').notNull(),
    proofId: uuid('proof_id'),
    /**
     * Set on a Corrected Payment: the original payment it corrects. The original
     * is never edited or deleted; a row with this set is the correction.
     */
    correctsPaymentId: uuid('corrects_payment_id'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: 'payments_member_fk', columns: [t.gymId, t.memberId], foreignColumns: [members.gymId, members.userId] }),
    foreignKey({ name: 'payments_recorded_by_fk', columns: [t.gymId, t.recordedBy], foreignColumns: [users.gymId, users.id] }),
    foreignKey({ name: 'payments_proof_fk', columns: [t.gymId, t.proofId], foreignColumns: [paymentProofs.gymId, paymentProofs.id] }),
    // The original must be a payment of the same gym.
    foreignKey({ name: 'payments_corrects_fk', columns: [t.gymId, t.correctsPaymentId], foreignColumns: [t.gymId, t.id] }),
    unique('payments_gym_id_unique').on(t.gymId, t.id),
    index('payments_gym_corrects_idx').on(t.gymId, t.correctsPaymentId),
    index('payments_gym_created_idx').on(t.gymId, t.createdAt),
    index('payments_gym_member_idx').on(t.gymId, t.memberId, t.createdAt),
  ],
);

// ---------- freeze_requests ----------

export const freezeRequests = pgTable(
  'freeze_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: gymRef(),
    memberId: uuid('member_id').notNull(),
    days: smallint('days').notNull(),
    reason: freezeReasonEnum('reason').notNull(),
    status: requestStatusEnum('status').notNull().default('pending'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: 'freeze_requests_member_fk', columns: [t.gymId, t.memberId], foreignColumns: [members.gymId, members.userId] }),
    index('freeze_requests_gym_status_idx').on(t.gymId, t.status, t.createdAt),
    // §4.6 and §7: 3 to 15 days.
    check('freeze_requests_days_range', sql`${t.days} between 3 and 15`),
  ],
);

// ---------- checkins ----------

export const checkins = pgTable(
  'checkins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: gymRef(),
    /** §7: every scan is saved; null when the scan identified no member. */
    memberId: uuid('member_id'),
    allowed: boolean('allowed').notNull(),
    reason: text('reason'),
    source: checkinSourceEnum('source').notNull(),
    /** Who scanned it (§7). The thumbprint machine has no staff user. */
    scannedBy: uuid('scanned_by'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: 'checkins_member_fk', columns: [t.gymId, t.memberId], foreignColumns: [members.gymId, members.userId] }),
    foreignKey({ name: 'checkins_scanned_by_fk', columns: [t.gymId, t.scannedBy], foreignColumns: [users.gymId, users.id] }),
    // §9: index on (gym_id, created_at).
    index('checkins_gym_created_idx').on(t.gymId, t.createdAt),
    index('checkins_gym_member_idx').on(t.gymId, t.memberId, t.createdAt),
  ],
);

// ---------- exercises ----------

export const exercises = pgTable(
  'exercises',
  {
    /** Slug, e.g. "squat". Primary key, so a slug is never duplicated. */
    id: text('id').primaryKey(),
    /** Null = built-in. */
    gymId: text('gym_id').references(() => gyms.id),
    name: text('name').notNull(),
    equipment: equipmentEnum('equipment').notNull(),
    muscle: muscleEnum('muscle').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // Exercise names are unique within each gym, ignoring case ("Squat" = "squat").
    // A gym's exercises include the built-ins, so a gym exercise may not reuse a
    // built-in name either: that check is a trigger in 0001_integrity_rules.sql.
    uniqueIndex('exercises_gym_name_ci_unique').on(t.gymId, sql`lower(${t.name})`),
    uniqueIndex('exercises_builtin_name_ci_unique').on(sql`lower(${t.name})`).where(sql`${t.gymId} is null`),
  ],
);

// ---------- trainer_plans ----------

export const trainerPlans = pgTable(
  'trainer_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: gymRef(),
    trainerId: uuid('trainer_id').notNull(),
    name: text('name').notNull(),
    date: day('date').notNull(),
    /** JSON list of plan items (§9 plan item shape; validated by the API). */
    items: jsonb('items').$type<PlanItem[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: 'trainer_plans_trainer_fk', columns: [t.gymId, t.trainerId], foreignColumns: [users.gymId, users.id] }),
    unique('trainer_plans_gym_id_unique').on(t.gymId, t.id),
    index('trainer_plans_gym_trainer_date_idx').on(t.gymId, t.trainerId, t.date),
    // §7: 1 to 15 exercises.
    check(
      'trainer_plans_items_count',
      sql`jsonb_typeof(${t.items}) = 'array' and jsonb_array_length(${t.items}) between 1 and 15`,
    ),
  ],
);

// ---------- plan_assignments ----------

export const planAssignments = pgTable(
  'plan_assignments',
  {
    planId: uuid('plan_id').notNull(),
    memberId: uuid('member_id').notNull(),
    /** §9: every table except built-in exercises carries gym_id. */
    gymId: gymRef(),
    /** JSON per exercise kg. */
    overrides: jsonb('overrides').$type<Record<string, number>>(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'plan_assignments_pk', columns: [t.planId, t.memberId] }),
    // Deleting a plan (§6 "Delete", §10 DELETE trainer/plans/:id) removes its assignments.
    foreignKey({ name: 'plan_assignments_plan_fk', columns: [t.gymId, t.planId], foreignColumns: [trainerPlans.gymId, trainerPlans.id] }).onDelete('cascade'),
    foreignKey({ name: 'plan_assignments_member_fk', columns: [t.gymId, t.memberId], foreignColumns: [members.gymId, members.userId] }),
    index('plan_assignments_gym_member_idx').on(t.gymId, t.memberId),
  ],
);

// ---------- exercise_sessions ----------

export const exerciseSessions = pgTable(
  'exercise_sessions',
  {
    /** From the phone; the server ignores IDs it already has (§7). */
    id: uuid('id').primaryKey(),
    gymId: gymRef(),
    memberId: uuid('member_id').notNull(),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id),
    /**
     * Required by the shared contract (§10): ExerciseSessionInput.planId and
     * TodayPlan.doneExerciseIds ("2 of 5 done", §4.4). The (gym_id, plan_id)
     * foreign key is in 0001_integrity_rules.sql.
     */
    planId: uuid('plan_id'),
    date: day('date').notNull(),
    /** JSON: kg, reps, warmup, plates, blocks. */
    sets: jsonb('sets').$type<SetEntry[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: 'exercise_sessions_member_fk', columns: [t.gymId, t.memberId], foreignColumns: [members.gymId, members.userId] }),
    index('exercise_sessions_member_exercise_idx').on(t.gymId, t.memberId, t.exerciseId, t.date),
    index('exercise_sessions_member_date_idx').on(t.gymId, t.memberId, t.date),
  ],
);

// ---------- trainer_sessions ----------

export const trainerSessions = pgTable(
  'trainer_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: gymRef(),
    /**
     * The trainer the session belongs to. A trainer creates their own; when the
     * owner creates one for a trainer, this is that selected trainer. The owner
     * sees every session of the gym.
     */
    trainerId: uuid('trainer_id').notNull(),
    memberId: uuid('member_id'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    title: text('title').notNull(),
    meta: text('meta'),
    kind: sessionKindEnum('kind').notNull(),
    done: boolean('done').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: 'trainer_sessions_trainer_fk', columns: [t.gymId, t.trainerId], foreignColumns: [users.gymId, users.id] }),
    foreignKey({ name: 'trainer_sessions_member_fk', columns: [t.gymId, t.memberId], foreignColumns: [members.gymId, members.userId] }),
    index('trainer_sessions_gym_trainer_starts_idx').on(t.gymId, t.trainerId, t.startsAt),
  ],
);

// ---------- announcements ----------

export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: gymRef(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: 'announcements_created_by_fk', columns: [t.gymId, t.createdBy], foreignColumns: [users.gymId, users.id] }),
    index('announcements_gym_created_idx').on(t.gymId, t.createdAt),
  ],
);

// ---------- whatsapp_messages ----------

export const whatsappMessages = pgTable(
  'whatsapp_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: gymRef(),
    memberId: uuid('member_id'),
    toPhone: text('to_phone').notNull(),
    kind: whatsappKindEnum('kind').notNull(),
    body: text('body').notNull(),
    status: whatsappStatusEnum('status').notNull().default('queued'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: 'whatsapp_messages_member_fk', columns: [t.gymId, t.memberId], foreignColumns: [members.gymId, members.userId] }),
    index('whatsapp_messages_gym_status_idx').on(t.gymId, t.status, t.createdAt),
    // §7: at most one fee reminder per member in 7 days (lookup by member, kind, time).
    index('whatsapp_messages_gym_member_kind_idx').on(t.gymId, t.memberId, t.kind, t.createdAt),
  ],
);

// ---------- due_date_changes (§11: owner-only due-date edits are logged) ----------

export const dueDateChanges = pgTable(
  'due_date_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: gymRef(),
    memberId: uuid('member_id').notNull(),
    oldDueOn: day('old_due_on').notNull(),
    newDueOn: day('new_due_on').notNull(),
    /** The owner who made the edit. */
    changedBy: uuid('changed_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: 'due_date_changes_member_fk', columns: [t.gymId, t.memberId], foreignColumns: [members.gymId, members.userId] }),
    foreignKey({ name: 'due_date_changes_changed_by_fk', columns: [t.gymId, t.changedBy], foreignColumns: [users.gymId, users.id] }),
    index('due_date_changes_gym_member_idx').on(t.gymId, t.memberId, t.createdAt),
  ],
);
