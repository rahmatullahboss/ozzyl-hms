-- 0353: Staff invitation linking
-- Adds user_id to staff and staff_id to invitations for invite acceptance
-- linking. Both columns are nullable; no CHECK/NOT NULL changes — minimum
-- blast-radius migration matching 0344_staff_extended_fields_email.sql style.

ALTER TABLE staff        ADD COLUMN user_id  INTEGER REFERENCES users(id);
ALTER TABLE invitations  ADD COLUMN staff_id INTEGER REFERENCES staff(id);

CREATE INDEX IF NOT EXISTS idx_staff_user        ON staff(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_staff ON invitations(tenant_id, staff_id);
