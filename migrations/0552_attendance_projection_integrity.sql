-- Attendance punch business-date and deterministic projection integrity.
-- Additive only: legacy hr_attendance.date/check_in/check_out/status remain for compatibility.

ALTER TABLE hr_attendance_punches ADD COLUMN business_date TEXT;

ALTER TABLE hr_attendance ADD COLUMN projection_status TEXT
  CHECK(projection_status IN ('present','absent','late','leave','half_day','off_day','incomplete'));
ALTER TABLE hr_attendance ADD COLUMN worked_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hr_attendance ADD COLUMN first_in_at_utc TEXT;
ALTER TABLE hr_attendance ADD COLUMN last_out_at_utc TEXT;
ALTER TABLE hr_attendance ADD COLUMN projection_updated_at_utc TEXT;

CREATE TABLE IF NOT EXISTS hr_attendance_projection_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  event_public_id TEXT NOT NULL,
  attendance_id INTEGER NOT NULL,
  staff_id INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  projection_status TEXT NOT NULL
    CHECK(projection_status IN ('present','absent','late','leave','half_day','off_day','incomplete')),
  projection_version INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_event_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  punch_type TEXT,
  occurred_at_utc TEXT,
  reason TEXT,
  actor_user_id INTEGER,
  created_at_utc TEXT NOT NULL,
  FOREIGN KEY (attendance_id) REFERENCES hr_attendance(id),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_attendance_projection_events_public_id
  ON hr_attendance_projection_events(tenant_id, event_public_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_attendance_projection_events_source
  ON hr_attendance_projection_events(tenant_id, source, source_event_key, projection_version);

CREATE INDEX IF NOT EXISTS idx_hr_attendance_projection_events_staff_date
  ON hr_attendance_projection_events(tenant_id, staff_id, business_date, projection_version);

CREATE INDEX IF NOT EXISTS idx_hr_attendance_punch_business_date
  ON hr_attendance_punches(tenant_id, staff_id, business_date, punch_time);
