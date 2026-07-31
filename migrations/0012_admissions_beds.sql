-- Admission / IPD Management
-- Migration 0012: admissions table + beds table

CREATE TABLE IF NOT EXISTS beds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  ward_name TEXT NOT NULL DEFAULT 'General',
  bed_number TEXT NOT NULL,
  bed_type TEXT NOT NULL DEFAULT 'general', -- general, icu, private, semi_private
  status TEXT NOT NULL DEFAULT 'available', -- available, occupied, maintenance, reserved
  floor TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, ward_name, bed_number)
);

CREATE TABLE IF NOT EXISTS admissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  admission_no TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  bed_id INTEGER,
  doctor_id INTEGER,
  admission_type TEXT NOT NULL DEFAULT 'planned', -- planned, emergency, transfer
  admission_date TEXT NOT NULL DEFAULT (datetime('now')),
  discharge_date TEXT,
  provisional_diagnosis TEXT,
  final_diagnosis TEXT,
  status TEXT NOT NULL DEFAULT 'admitted', -- admitted, discharged, transferred, critical
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, admission_no)
);

-- Seed some beds
INSERT OR IGNORE INTO beds (tenant_id, ward_name, bed_number, bed_type, status, floor) VALUES
  (1, 'Ward A', 'A-1', 'general', 'available', '1st Floor'),
  (1, 'Ward A', 'A-2', 'general', 'available', '1st Floor'),
  (1, 'Ward A', 'A-3', 'general', 'available', '1st Floor'),
  (1, 'Ward A', 'A-4', 'general', 'available', '1st Floor'),
  (1, 'Ward A', 'A-5', 'general', 'available', '1st Floor'),
  (1, 'Ward B', 'B-1', 'semi_private', 'available', '2nd Floor'),
  (1, 'Ward B', 'B-2', 'semi_private', 'available', '2nd Floor'),
  (1, 'Ward B', 'B-3', 'semi_private', 'available', '2nd Floor'),
  (1, 'Ward C', 'C-1', 'private', 'available', '2nd Floor'),
  (1, 'Ward C', 'C-2', 'private', 'available', '2nd Floor'),
  (1, 'ICU', 'ICU-1', 'icu', 'available', '3rd Floor'),
  (1, 'ICU', 'ICU-2', 'icu', 'available', '3rd Floor'),
  (1, 'ICU', 'ICU-3', 'icu', 'available', '3rd Floor'),
  (1, 'Ward D', 'D-1', 'general', 'available', '1st Floor'),
  (1, 'Ward D', 'D-2', 'general', 'available', '1st Floor'),
  (1, 'Ward D', 'D-3', 'general', 'available', '1st Floor'),
  (1, 'Ward D', 'D-4', 'general', 'available', '1st Floor'),
  (1, 'Ward D', 'D-5', 'general', 'available', '1st Floor'),
  (1, 'Ward D', 'D-6', 'general', 'available', '1st Floor'),
  (1, 'Ward D', 'D-7', 'general', 'available', '1st Floor');
