-- Allow intentional duplicate manual appointment serials while keeping auto/reserved serials protected.

ALTER TABLE appointments ADD COLUMN token_assignment_type TEXT NOT NULL DEFAULT 'auto' CHECK(token_assignment_type IN ('auto', 'reserved', 'manual'));

DROP INDEX IF EXISTS idx_appointments_token;
DROP INDEX IF EXISTS idx_appointments_token_non_manual;
DROP INDEX IF EXISTS idx_appointments_token_lookup;

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_token_non_manual ON appointments(tenant_id, doctor_id, appt_date, token_no) WHERE COALESCE(token_assignment_type, 'auto') <> 'manual' AND status NOT IN ('cancelled', 'no_show');

CREATE INDEX IF NOT EXISTS idx_appointments_token_lookup ON appointments(tenant_id, doctor_id, appt_date, token_no);
