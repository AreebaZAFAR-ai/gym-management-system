-- Every member now has a due date: a payment sets it, and a member registered
-- without a first payment is due from the joining date (§1: overdue members are
-- blocked at the door). 0005 filled in the older empty ones, so this only makes
-- the rule part of the schema. No rows are changed. Review before applying to Neon.
ALTER TABLE "members" ALTER COLUMN "due_on" SET NOT NULL;
