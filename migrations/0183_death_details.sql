-- Migration 0183: Death details for in-hospital deaths
-- Reference: DanpheEMR DeathDetailsModel.cs

CREATE TABLE IF NOT EXISTS death_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  admission_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  date_of_death TEXT NOT NULL,
  time_of_death TEXT,
  cause_of_death TEXT,
  secondary_cause TEXT,
  manner_of_death TEXT DEFAULT 'natural',
  place_of_death TEXT DEFAULT 'hospital',
  certifying_doctor_id INTEGER,
  certifying_doctor_name TEXT,
  is_mlc INTEGER NOT NULL DEFAULT 0,
  is_autopsy_required INTEGER NOT NULL DEFAULT 0,
  autopsy_findings TEXT,
  death_certificate_no TEXT,
  death_certificate_issued INTEGER NOT NULL DEFAULT 0,
  death_certificate_issued_on TEXT,
  next_of_kin_name TEXT,
  next_of_kin_relation TEXT,
  next_of_kin_phone TEXT,
  next_of_kin_notified INTEGER NOT NULL DEFAULT 0,
  remarks TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (admission_id) REFERENCES admissions(id),
  FOREIGN KEY (patient_id) REFERENCES patients(id)
);

-- Earlier medical-record migrations already created death_details with a
-- certificate-oriented schema. Add Danphe/IPD death-record columns expected by
-- the current deathRecords route.
ALTER TABLE death_details ADD COLUMN admission_id INTEGER;
ALTER TABLE death_details ADD COLUMN date_of_death TEXT;
ALTER TABLE death_details ADD COLUMN time_of_death TEXT;
ALTER TABLE death_details ADD COLUMN certifying_doctor_id INTEGER;
ALTER TABLE death_details ADD COLUMN certifying_doctor_name TEXT;
ALTER TABLE death_details ADD COLUMN is_mlc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE death_details ADD COLUMN is_autopsy_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE death_details ADD COLUMN autopsy_findings TEXT;
ALTER TABLE death_details ADD COLUMN death_certificate_no TEXT;
ALTER TABLE death_details ADD COLUMN death_certificate_issued INTEGER NOT NULL DEFAULT 0;
ALTER TABLE death_details ADD COLUMN death_certificate_issued_on TEXT;
ALTER TABLE death_details ADD COLUMN next_of_kin_name TEXT;
ALTER TABLE death_details ADD COLUMN next_of_kin_relation TEXT;
ALTER TABLE death_details ADD COLUMN next_of_kin_phone TEXT;
ALTER TABLE death_details ADD COLUMN next_of_kin_notified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE death_details ADD COLUMN remarks TEXT;

UPDATE death_details
SET date_of_death = COALESCE(date_of_death, death_date),
    time_of_death = COALESCE(time_of_death, death_time),
    death_certificate_no = COALESCE(death_certificate_no, certificate_number)
WHERE date_of_death IS NULL OR time_of_death IS NULL OR death_certificate_no IS NULL;

CREATE INDEX IF NOT EXISTS idx_death_details_tenant ON death_details(tenant_id);
CREATE INDEX IF NOT EXISTS idx_death_details_admission ON death_details(admission_id);
CREATE INDEX IF NOT EXISTS idx_death_details_patient ON death_details(patient_id);
