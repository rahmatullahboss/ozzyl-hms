-- Vitals / Nurse Station
-- Migration 0014: patient_vitals table

CREATE TABLE IF NOT EXISTS patient_vitals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  admission_id INTEGER,
  systolic INTEGER,
  diastolic INTEGER,
  temperature REAL,
  heart_rate INTEGER,
  spo2 INTEGER,
  respiratory_rate INTEGER,
  weight REAL,
  notes TEXT,
  recorded_by TEXT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vitals_patient ON patient_vitals(tenant_id, patient_id, recorded_at);
