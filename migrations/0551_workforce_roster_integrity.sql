-- Workforce roster lifecycle, mutation idempotency, and attendance projection integrity.
-- Additive only: existing workforce authorities and compatibility columns remain unchanged.

ALTER TABLE hr_duty_roster ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hr_duty_roster ADD COLUMN updated_by INTEGER;

CREATE TABLE IF NOT EXISTS hr_roster_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  event_public_id TEXT NOT NULL,
  roster_id INTEGER NOT NULL,
  staff_id INTEGER NOT NULL,
  roster_date TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('assigned','reassigned','reactivated','swapped','cancelled','generated')),
  from_shift_id INTEGER,
  to_shift_id INTEGER,
  related_staff_id INTEGER,
  reason TEXT,
  actor_user_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  occurred_at_utc TEXT NOT NULL,
  FOREIGN KEY (roster_id) REFERENCES hr_duty_roster(id),
  FOREIGN KEY (staff_id) REFERENCES staff(id),
  FOREIGN KEY (from_shift_id) REFERENCES hr_shifts(id),
  FOREIGN KEY (to_shift_id) REFERENCES hr_shifts(id),
  FOREIGN KEY (related_staff_id) REFERENCES staff(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_roster_events_public_id
  ON hr_roster_events(tenant_id, event_public_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_roster_events_idempotency
  ON hr_roster_events(tenant_id, idempotency_key, roster_id, event_type);

CREATE INDEX IF NOT EXISTS idx_hr_roster_events_roster
  ON hr_roster_events(tenant_id, roster_id, occurred_at_utc);

CREATE INDEX IF NOT EXISTS idx_hr_roster_events_staff_date
  ON hr_roster_events(tenant_id, staff_id, roster_date, occurred_at_utc);

CREATE TABLE IF NOT EXISTS workforce_mutation_idempotency (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  mutation_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('processing','completed','failed')),
  result_json TEXT,
  created_by INTEGER NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE(tenant_id, mutation_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_workforce_mutation_idempotency_status
  ON workforce_mutation_idempotency(tenant_id, mutation_type, status, updated_at_utc);

ALTER TABLE hr_attendance_punches ADD COLUMN source_event_key TEXT;
ALTER TABLE hr_attendance_punches ADD COLUMN request_hash TEXT;

ALTER TABLE hr_attendance ADD COLUMN business_date TEXT;
ALTER TABLE hr_attendance ADD COLUMN projection_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hr_attendance ADD COLUMN roster_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_attendance_punch_source_event
  ON hr_attendance_punches(tenant_id, source, source_event_key)
  WHERE source_event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hr_attendance_business_date
  ON hr_attendance(tenant_id, business_date, staff_id);

CREATE INDEX IF NOT EXISTS idx_hr_attendance_roster
  ON hr_attendance(tenant_id, roster_id)
  WHERE roster_id IS NOT NULL;
