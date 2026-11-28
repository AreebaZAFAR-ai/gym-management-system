-- §6 Add member: "Optional first payment with method."
-- 0001_integrity_rules.sql required a payment for every new member (deferred
-- constraint trigger), and members.due_on was NOT NULL because the due date came
-- only from that first payment. Both block registering a member without a payment.
--
-- This migration removes only that rule. No rows are changed or deleted; payments
-- stay append-only (0001 section 1 is untouched). A member registered without a
-- payment has no due date (NULL) until reception records their first payment.
DROP TRIGGER IF EXISTS members_require_payment ON members;
--> statement-breakpoint
DROP FUNCTION IF EXISTS check_member_has_payment();
--> statement-breakpoint
ALTER TABLE "members" ALTER COLUMN "due_on" DROP NOT NULL;
