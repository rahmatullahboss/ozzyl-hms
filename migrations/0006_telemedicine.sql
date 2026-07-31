-- Migration: 0006_telemedicine.sql
-- Adds telemedicine consultations table.
--
-- Apply locally:  npx wrangler d1 execute DB --local --file=migrations/0006_telemedicine.sql
-- Apply staging:  npx wrangler d1 execute DB --env staging --remote --file=migrations/0006_telemedicine.sql
-- Apply prod:     npx wrangler d1 execute DB --env production --remote --file=migrations/0006_telemedicine.sql

CREATE TABLE IF NOT EXISTS consultations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id     INTEGER NOT NULL,
  patient_id    INTEGER NOT NULL,
  scheduled_at  TEXT    NOT NULL,             -- ISO datetime e.g. "2025-12-01T10:30:00"
  duration_min  INTEGER NOT NULL DEFAULT 30,  -- planned duration in minutes
  room_url      TEXT,                         -- video room URL (Daily.co or Jitsi fallback)
  room_name     TEXT,                         -- internal room identifier
  status        TEXT    NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show')),
  notes         TEXT,                         -- pre-consultation notes
  prescription  TEXT,                         -- post-consultation prescription (free text or JSON)
  chief_complaint TEXT,
  followup_date TEXT,
  tenant_id     TEXT    NOT NULL,
  created_by    TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_consultations_tenant   ON consultations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_consultations_doctor   ON consultations(tenant_id, doctor_id);
CREATE INDEX IF NOT EXISTS idx_consultations_patient  ON consultations(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_consultations_schedule ON consultations(tenant_id, scheduled_at);
