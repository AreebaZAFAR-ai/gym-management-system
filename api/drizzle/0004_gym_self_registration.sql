-- Gym self-registration (web admin "Register your gym").
-- Additive only: four nullable contact columns and two case-insensitive unique
-- indexes. Existing rows keep NULL (NULLs never collide in a unique index); no
-- data is changed or deleted. Emails are contact details only, never a login (§2).
ALTER TABLE "gyms" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email" text;--> statement-breakpoint
CREATE UNIQUE INDEX "gyms_email_ci_unique" ON "gyms" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_ci_unique" ON "users" USING btree (lower("email"));