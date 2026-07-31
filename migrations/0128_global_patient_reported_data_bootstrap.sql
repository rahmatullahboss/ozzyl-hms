CREATE TABLE IF NOT EXISTS global_patient_reported_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uhid TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('allergy', 'chronic_condition', 'current_health_issue', 'current_medication')),
  name TEXT NOT NULL,
  severity TEXT,
  clinical_status TEXT DEFAULT 'active',
  verification_status TEXT DEFAULT 'unconfirmed',
  start_date TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uhid) REFERENCES global_patient_identity(uhid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_prd_uhid ON global_patient_reported_data(uhid);
CREATE INDEX IF NOT EXISTS idx_prd_category ON global_patient_reported_data(category);
