-- Migration 0041: Allow 'emergency' visit_type in visits table
-- SQLite cannot ALTER CHECK constraints, so we must recreate the table
-- Must disable FK checks during table swap

PRAGMA foreign_keys=OFF;

-- Step 1: Create new table with expanded CHECK
CREATE TABLE visits_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id      INTEGER NOT NULL,
  visit_no        TEXT,
  doctor_id       INTEGER,
  visit_type      TEXT NOT NULL DEFAULT 'opd' CHECK(visit_type IN ('opd', 'ipd', 'emergency')),
  admission_flag  INTEGER NOT NULL DEFAULT 0,
  admission_no    TEXT,
  admission_date  DATETIME,
  discharge_date  DATETIME,
  notes           TEXT,
  tenant_id       INTEGER NOT NULL,
  created_by      INTEGER,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  icd10_code      TEXT,
  icd10_description TEXT,
  branch_id       INTEGER REFERENCES branches(id),
  visit_date      TEXT,
  status          TEXT DEFAULT 'initiated',
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (doctor_id)  REFERENCES doctors(id)
);

-- Step 2: Copy existing data
INSERT INTO visits_new SELECT * FROM visits;

-- Step 3: Drop old table
DROP TABLE visits;

-- Step 4: Rename new table
ALTER TABLE visits_new RENAME TO visits;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id);
CREATE INDEX IF NOT EXISTS idx_visits_tenant ON visits(tenant_id);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(visit_date);

PRAGMA foreign_keys=ON;
