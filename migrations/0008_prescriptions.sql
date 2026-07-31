-- Migration: 0008_prescriptions.sql
-- Creates prescriptions, prescription_items, and visits (OPD) tables

-- ─── Prescriptions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prescriptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  rx_no           TEXT    NOT NULL,                -- auto: RX-0001
  patient_id      INTEGER NOT NULL REFERENCES patients(id),
  doctor_id       INTEGER REFERENCES doctors(id),
  appointment_id  INTEGER REFERENCES appointments(id),

  -- Vitals
  bp              TEXT,             -- e.g. "120/80"
  temperature     TEXT,             -- e.g. "98.6°F"
  weight          TEXT,             -- e.g. "72 kg"
  spo2            TEXT,             -- e.g. "98%"

  -- Clinical notes
  chief_complaint TEXT,
  diagnosis       TEXT,             -- ICD-10 code or free text
  examination_notes TEXT,
  advice          TEXT,
  lab_tests       TEXT,             -- JSON array: ["CBC","LFT"]
  follow_up_date  TEXT,             -- YYYY-MM-DD

  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','final')),

  created_by      INTEGER NOT NULL,
  tenant_id       TEXT    NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Prescription Items (medicines) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prescription_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  prescription_id INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medicine_name   TEXT NOT NULL,
  dosage          TEXT,             -- e.g. "500mg"
  frequency       TEXT,             -- e.g. "1+0+1"
  duration        TEXT,             -- e.g. "5 Days"
  instructions    TEXT,             -- e.g. "After Food"
  sort_order      INTEGER DEFAULT 0
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient   ON prescriptions(patient_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_doctor    ON prescriptions(doctor_id,  tenant_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_appt      ON prescriptions(appointment_id);
CREATE INDEX IF NOT EXISTS idx_prescription_items_rx   ON prescription_items(prescription_id);
