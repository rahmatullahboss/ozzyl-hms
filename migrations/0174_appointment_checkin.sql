-- Migration number: 0174   2026-04-30T00:00:00.000Z
-- Bridge appointments → visits: add check-in flow

-- 1. Link visits back to the appointment that triggered them
ALTER TABLE visits ADD COLUMN appointment_id INTEGER REFERENCES appointments(id);

-- 2. Track when a patient was checked in
ALTER TABLE appointments ADD COLUMN checked_in_at TEXT;

-- 3. Index for fast visit lookup by appointment
CREATE INDEX IF NOT EXISTS idx_visits_appointment ON visits(appointment_id);
