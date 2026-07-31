-- Blood Sugar Monitoring for Nursing
CREATE TABLE IF NOT EXISTS nur_blood_sugar_monitoring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER NOT NULL,
  entry_datetime TEXT DEFAULT (datetime('now', '+6 hours')),
  rbs_value REAL NOT NULL,
  insulin REAL,
  remarks TEXT,
  is_active INTEGER DEFAULT 1,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_blood_sugar_visit
  ON nur_blood_sugar_monitoring(tenant_id, visit_id, is_active);

CREATE INDEX IF NOT EXISTS idx_blood_sugar_patient
  ON nur_blood_sugar_monitoring(tenant_id, patient_id, is_active);
