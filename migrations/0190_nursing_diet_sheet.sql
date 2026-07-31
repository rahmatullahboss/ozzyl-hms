-- Diet Sheet Management
-- Master table: diet types (Regular, Diabetic, Liquid, Soft, etc.)

CREATE TABLE IF NOT EXISTS nur_diet_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  diet_code TEXT NOT NULL,
  diet_name TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_diet_types_code
  ON nur_diet_types(tenant_id, diet_code);

-- Transaction table: patient diet assignments

CREATE TABLE IF NOT EXISTS nur_patient_diets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER NOT NULL,
  diet_type_id INTEGER NOT NULL,
  extra_diet TEXT,
  ward_id INTEGER,
  remarks TEXT,
  recorded_on TEXT DEFAULT (datetime('now', '+6 hours')),
  is_active INTEGER DEFAULT 1,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_patient_diets_visit
  ON nur_patient_diets(tenant_id, visit_id, is_active);

CREATE INDEX IF NOT EXISTS idx_patient_diets_patient
  ON nur_patient_diets(tenant_id, patient_id, is_active);

-- Seed default diet types (tenant_id=0 = global defaults)
INSERT INTO nur_diet_types (tenant_id, diet_code, diet_name, display_order, created_by)
VALUES
  (0, 'REG', 'Regular', 1, 'system'),
  (0, 'DIA', 'Diabetic', 2, 'system'),
  (0, 'LIQ', 'Liquid', 3, 'system'),
  (0, 'SFT', 'Soft', 4, 'system'),
  (0, 'RENAL', 'Renal', 5, 'system'),
  (0, 'LOW_SOD', 'Low Sodium', 6, 'system'),
  (0, 'HIGH_PROT', 'High Protein', 7, 'system'),
  (0, 'NPO', 'NPO (Nothing by Mouth)', 8, 'system');
