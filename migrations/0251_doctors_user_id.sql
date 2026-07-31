-- Link doctors to user accounts so the doctor dashboard can resolve
-- the doctor profile from the authenticated user's JWT.
ALTER TABLE doctors ADD COLUMN user_id INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_doctors_user_id ON doctors(tenant_id, user_id);

-- Backfill: link demo doctor user (id=108, role=doctor) to doctor record
-- User 108 is "Dr. Farhana Haque" (doctor@demo-hospital.com)
-- Doctor 108 is "Dr. Sayeda Khanam" (Ophthalmology)
-- Link them so the doctor dashboard works for the demo account.
UPDATE doctors SET user_id = 108 WHERE id = 108 AND tenant_id = 100;
