-- =============================================================================
-- HMS Seed Column Fix
-- Adds missing/renamed columns to align local D1 schema with seed_demo.sql
-- Run after bootstrap.sql and migrations, but BEFORE seed_demo.sql
-- =============================================================================

-- Add mobile_number to doctors (seed uses mobile_number, bootstrap used mobile)
ALTER TABLE doctors ADD COLUMN mobile_number TEXT;

-- Add advice and follow_up_date to prescriptions (seed uses these columns)
ALTER TABLE prescriptions ADD COLUMN advice TEXT;
ALTER TABLE prescriptions ADD COLUMN follow_up_date TEXT;

-- Add mobile_number to suppliers (seed uses mobile_number, bootstrap used mobile)
ALTER TABLE suppliers ADD COLUMN mobile_number TEXT;

-- Add notes to admissions (seed includes notes column)
ALTER TABLE admissions ADD COLUMN notes TEXT;

-- Add appt_no token_no fee to appointments (seed uses these)
-- (appointments table should already exist from migration 0007)

-- Add patient_vitals table if not already created by migrations
CREATE TABLE IF NOT EXISTS patient_vitals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id     INTEGER NOT NULL,
  visit_id       INTEGER,
  bp_systolic    INTEGER,
  bp_diastolic   INTEGER,
  temperature    REAL,
  pulse          INTEGER,
  spo2           INTEGER,
  weight         REAL,
  height         REAL,
  recorded_by    INTEGER,
  recorded_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  tenant_id      INTEGER NOT NULL
);
