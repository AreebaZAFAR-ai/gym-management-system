-- §1/§7: a member registered without a first payment must not stay Active forever.
-- New registrations without a payment now get due_on = joined_on (Overdue at once,
-- blocked at the door once grace days pass). This backfills members registered that
-- way before the change. Data only: no columns change; payments are untouched.
-- Review before applying to Neon.
UPDATE "members" SET "due_on" = "joined_on" WHERE "due_on" IS NULL;
