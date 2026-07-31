-- =============================================================================
-- HMS Migration 0007: Appointments Table
-- Applied: 2026-03-12
-- =============================================================================

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────────────────────
-- APPOINTMENTS (OPD scheduling with token/serial number generation)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  appt_no         TEXT    NOT NULL,                   -- auto-generated e.g. APT-000001
  token_no        INTEGER NOT NULL,                   -- daily serial e.g. 1, 2, 3...
  patient_id      INTEGER NOT NULL,
  doctor_id       INTEGER,
  appt_date       TEXT    NOT NULL,                   -- ISO date "YYYY-MM-DD"
  appt_time       TEXT,                               -- "HH:MM" 24h format
  visit_type      TEXT    NOT NULL DEFAULT 'opd'
                    CHECK(visit_type IN ('opd', 'followup', 'emergency')),
  status          TEXT    NOT NULL DEFAULT 'scheduled'
                    CHECK(status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  notes           TEXT,
  chief_complaint TEXT,
  fee             INTEGER NOT NULL DEFAULT 0,         -- in taka
  created_by      INTEGER,
  tenant_id       INTEGER NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (doctor_id)  REFERENCES doctors(id)
);

CREATE INDEX IF NOT EXISTS idx_appointments_tenant  ON appointments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date    ON appointments(appt_date);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor  ON appointments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status  ON appointments(status);

-- Unique constraint: one token per doctor per date per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_token
  ON appointments(tenant_id, doctor_id, appt_date, token_no);
