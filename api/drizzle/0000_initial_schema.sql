CREATE TYPE "public"."checkin_source" AS ENUM('qr', 'manual', 'fingerprint');--> statement-breakpoint
CREATE TYPE "public"."equipment" AS ENUM('bar', 'db', 'machine', 'body');--> statement-breakpoint
CREATE TYPE "public"."freeze_reason" AS ENUM('travel', 'illness', 'other');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('male', 'female', 'other');--> statement-breakpoint
CREATE TYPE "public"."goal" AS ENUM('strength', 'muscle', 'fat_loss', 'fitness');--> statement-breakpoint
CREATE TYPE "public"."muscle" AS ENUM('chest', 'back', 'legs', 'shoulders', 'arms', 'core');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'jazzcash', 'easypaisa', 'bank');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('member', 'reception', 'trainer', 'owner');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('pt', 'class');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_kind" AS ENUM('receipt', 'reminder', 'welcome', 'announcement', 'other');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" text NOT NULL,
	"member_id" uuid,
	"allowed" boolean NOT NULL,
	"reason" text,
	"source" "checkin_source" NOT NULL,
	"scanned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "due_date_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" text NOT NULL,
	"member_id" uuid NOT NULL,
	"old_due_on" date NOT NULL,
	"new_due_on" date NOT NULL,
	"changed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"gym_id" text NOT NULL,
	"member_id" uuid NOT NULL,
	"exercise_id" text NOT NULL,
	"plan_id" uuid,
	"date" date NOT NULL,
	"sets" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"gym_id" text,
	"name" text NOT NULL,
	"equipment" "equipment" NOT NULL,
	"muscle" "muscle" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freeze_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" text NOT NULL,
	"member_id" uuid NOT NULL,
	"days" smallint NOT NULL,
	"reason" "freeze_reason" NOT NULL,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "freeze_requests_days_range" CHECK ("freeze_requests"."days" between 3 and 15)
);
--> statement-breakpoint
CREATE TABLE "gyms" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short" text NOT NULL,
	"city" text NOT NULL,
	"primary_color" text NOT NULL,
	"member_prefix" text NOT NULL,
	"last_member_number" integer DEFAULT 0 NOT NULL,
	"pay_to_label" text DEFAULT '' NOT NULL,
	"pay_to_number" text DEFAULT '' NOT NULL,
	"pay_to_title" text DEFAULT '' NOT NULL,
	"reception_whatsapp" text DEFAULT '' NOT NULL,
	"checkin_secret" text NOT NULL,
	"grace_days" smallint DEFAULT 3 NOT NULL,
	"device_address" text,
	"device_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"gym_id" text NOT NULL,
	"code" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"trainer_id" uuid,
	"joined_on" date NOT NULL,
	"due_on" date NOT NULL,
	"frozen_until" date,
	"goal" "goal",
	"gender" "gender",
	"emergency_contact" text,
	"fingerprint_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_gym_code_unique" UNIQUE("gym_id","code"),
	CONSTRAINT "members_gym_user_unique" UNIQUE("gym_id","user_id"),
	CONSTRAINT "members_gym_fingerprint_unique" UNIQUE("gym_id","fingerprint_id")
);
--> statement-breakpoint
CREATE TABLE "payment_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" text NOT NULL,
	"member_id" uuid NOT NULL,
	"image_url" text NOT NULL,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_proofs_gym_id_unique" UNIQUE("gym_id","id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" text NOT NULL,
	"member_id" uuid NOT NULL,
	"amount_pkr" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"txn_id" text,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"recorded_by" uuid NOT NULL,
	"proof_id" uuid,
	"corrects_payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_gym_id_unique" UNIQUE("gym_id","id")
);
--> statement-breakpoint
CREATE TABLE "plan_assignments" (
	"plan_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"gym_id" text NOT NULL,
	"overrides" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_assignments_pk" PRIMARY KEY("plan_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" text NOT NULL,
	"name" text NOT NULL,
	"timing" text,
	"fee_pkr" integer NOT NULL,
	"months" smallint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_gym_id_unique" UNIQUE("gym_id","id")
);
--> statement-breakpoint
CREATE TABLE "trainer_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" text NOT NULL,
	"trainer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"date" date NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trainer_plans_gym_id_unique" UNIQUE("gym_id","id"),
	CONSTRAINT "trainer_plans_items_count" CHECK (jsonb_typeof("trainer_plans"."items") = 'array' and jsonb_array_length("trainer_plans"."items") between 1 and 15)
);
--> statement-breakpoint
CREATE TABLE "trainer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" text NOT NULL,
	"trainer_id" uuid NOT NULL,
	"member_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"meta" text,
	"kind" "session_kind" NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" text NOT NULL,
	"phone" char(10) NOT NULL,
	"name" text NOT NULL,
	"role" "role" NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_gym_phone_unique" UNIQUE("gym_id","phone"),
	CONSTRAINT "users_gym_id_unique" UNIQUE("gym_id","id"),
	CONSTRAINT "users_phone_format" CHECK (phone ~ '^3[0-9]{9}$')
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" text NOT NULL,
	"member_id" uuid,
	"to_phone" text NOT NULL,
	"kind" "whatsapp_kind" NOT NULL,
	"body" text NOT NULL,
	"status" "whatsapp_status" DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_fk" FOREIGN KEY ("gym_id","created_by") REFERENCES "public"."users"("gym_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_member_fk" FOREIGN KEY ("gym_id","member_id") REFERENCES "public"."members"("gym_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_scanned_by_fk" FOREIGN KEY ("gym_id","scanned_by") REFERENCES "public"."users"("gym_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_date_changes" ADD CONSTRAINT "due_date_changes_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_date_changes" ADD CONSTRAINT "due_date_changes_member_fk" FOREIGN KEY ("gym_id","member_id") REFERENCES "public"."members"("gym_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_date_changes" ADD CONSTRAINT "due_date_changes_changed_by_fk" FOREIGN KEY ("gym_id","changed_by") REFERENCES "public"."users"("gym_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_sessions" ADD CONSTRAINT "exercise_sessions_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_sessions" ADD CONSTRAINT "exercise_sessions_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_sessions" ADD CONSTRAINT "exercise_sessions_member_fk" FOREIGN KEY ("gym_id","member_id") REFERENCES "public"."members"("gym_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freeze_requests" ADD CONSTRAINT "freeze_requests_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freeze_requests" ADD CONSTRAINT "freeze_requests_member_fk" FOREIGN KEY ("gym_id","member_id") REFERENCES "public"."members"("gym_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_fk" FOREIGN KEY ("gym_id","user_id") REFERENCES "public"."users"("gym_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_plan_fk" FOREIGN KEY ("gym_id","plan_id") REFERENCES "public"."plans"("gym_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_trainer_fk" FOREIGN KEY ("gym_id","trainer_id") REFERENCES "public"."users"("gym_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_member_fk" FOREIGN KEY ("gym_id","member_id") REFERENCES "public"."members"("gym_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_member_fk" FOREIGN KEY ("gym_id","member_id") REFERENCES "public"."members"("gym_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_fk" FOREIGN KEY ("gym_id","recorded_by") REFERENCES "public"."users"("gym_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_proof_fk" FOREIGN KEY ("gym_id","proof_id") REFERENCES "public"."payment_proofs"("gym_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_corrects_fk" FOREIGN KEY ("gym_id","corrects_payment_id") REFERENCES "public"."payments"("gym_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_assignments" ADD CONSTRAINT "plan_assignments_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_assignments" ADD CONSTRAINT "plan_assignments_plan_fk" FOREIGN KEY ("gym_id","plan_id") REFERENCES "public"."trainer_plans"("gym_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_assignments" ADD CONSTRAINT "plan_assignments_member_fk" FOREIGN KEY ("gym_id","member_id") REFERENCES "public"."members"("gym_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_plans" ADD CONSTRAINT "trainer_plans_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_plans" ADD CONSTRAINT "trainer_plans_trainer_fk" FOREIGN KEY ("gym_id","trainer_id") REFERENCES "public"."users"("gym_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_sessions" ADD CONSTRAINT "trainer_sessions_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_sessions" ADD CONSTRAINT "trainer_sessions_trainer_fk" FOREIGN KEY ("gym_id","trainer_id") REFERENCES "public"."users"("gym_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_sessions" ADD CONSTRAINT "trainer_sessions_member_fk" FOREIGN KEY ("gym_id","member_id") REFERENCES "public"."members"("gym_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_member_fk" FOREIGN KEY ("gym_id","member_id") REFERENCES "public"."members"("gym_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_gym_created_idx" ON "announcements" USING btree ("gym_id","created_at");--> statement-breakpoint
CREATE INDEX "checkins_gym_created_idx" ON "checkins" USING btree ("gym_id","created_at");--> statement-breakpoint
CREATE INDEX "checkins_gym_member_idx" ON "checkins" USING btree ("gym_id","member_id","created_at");--> statement-breakpoint
CREATE INDEX "due_date_changes_gym_member_idx" ON "due_date_changes" USING btree ("gym_id","member_id","created_at");--> statement-breakpoint
CREATE INDEX "exercise_sessions_member_exercise_idx" ON "exercise_sessions" USING btree ("gym_id","member_id","exercise_id","date");--> statement-breakpoint
CREATE INDEX "exercise_sessions_member_date_idx" ON "exercise_sessions" USING btree ("gym_id","member_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_gym_name_ci_unique" ON "exercises" USING btree ("gym_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_builtin_name_ci_unique" ON "exercises" USING btree (lower("name")) WHERE "exercises"."gym_id" is null;--> statement-breakpoint
CREATE INDEX "freeze_requests_gym_status_idx" ON "freeze_requests" USING btree ("gym_id","status","created_at");--> statement-breakpoint
CREATE INDEX "members_gym_due_on_idx" ON "members" USING btree ("gym_id","due_on");--> statement-breakpoint
CREATE INDEX "members_gym_trainer_idx" ON "members" USING btree ("gym_id","trainer_id");--> statement-breakpoint
CREATE INDEX "payment_proofs_gym_status_idx" ON "payment_proofs" USING btree ("gym_id","status","created_at");--> statement-breakpoint
CREATE INDEX "payments_gym_corrects_idx" ON "payments" USING btree ("gym_id","corrects_payment_id");--> statement-breakpoint
CREATE INDEX "payments_gym_created_idx" ON "payments" USING btree ("gym_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_gym_member_idx" ON "payments" USING btree ("gym_id","member_id","created_at");--> statement-breakpoint
CREATE INDEX "plan_assignments_gym_member_idx" ON "plan_assignments" USING btree ("gym_id","member_id");--> statement-breakpoint
CREATE INDEX "trainer_plans_gym_trainer_date_idx" ON "trainer_plans" USING btree ("gym_id","trainer_id","date");--> statement-breakpoint
CREATE INDEX "trainer_sessions_gym_trainer_starts_idx" ON "trainer_sessions" USING btree ("gym_id","trainer_id","starts_at");--> statement-breakpoint
CREATE INDEX "users_gym_role_idx" ON "users" USING btree ("gym_id","role");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_gym_status_idx" ON "whatsapp_messages" USING btree ("gym_id","status","created_at");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_gym_member_kind_idx" ON "whatsapp_messages" USING btree ("gym_id","member_id","kind","created_at");