-- Migration: 0274_prescription_overrides.sql
-- Adds prescription safety override audit trail for allergy/interaction/duplicate overrides

CREATE TABLE IF NOT EXISTS prescription_overrides (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  prescription_id INTEGER NOT NULL,
  patient_id      INTEGER NOT NULL,
  doctor_id       INTEGER NOT NULL,
  override_type   TEXT    NOT NULL CHECK (override_type IN ('allergy', 'interaction', 'duplicate')),
  allergen        TEXT    NOT NULL,
  severity        TEXT,
  reason          TEXT    NOT NULL,
  tenant_id       TEXT    NOT NULL,
  created_at      TEXT    DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX IF NOT EXISTS idx_prescription_overrides_rx ON prescription_overrides(tenant_id, prescription_id);
CREATE INDEX IF NOT EXISTS idx_prescription_overrides_patient ON prescription_overrides(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_prescription_overrides_doctor ON prescription_overrides(tenant_id, doctor_id);
