-- Nursing Respiratory tracking (Oxygen & Nebulization)
CREATE TABLE IF NOT EXISTS nursing_respiratory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  admission_id INTEGER,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('oxygen', 'nebulization')),
  -- Oxygen fields
  delivery_mode TEXT CHECK (delivery_mode IN ('Nasal Cannula', 'Face Mask', 'Non-rebreather', 'HFNC')),
  flow_rate REAL,
  start_time TEXT,
  spo2_before INTEGER,
  spo2_after INTEGER,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'stopped')),
  -- Nebulization fields
  medicine_name TEXT,
  dose TEXT,
  time_given TEXT,
  given_by TEXT,
  response TEXT CHECK (response IN ('improved', 'no_change', 'worse')),
  -- Common
  notes TEXT,
  is_active INTEGER DEFAULT 1,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nursing_respiratory_patient ON nursing_respiratory(tenant_id, patient_id, is_active);
CREATE INDEX IF NOT EXISTS idx_nursing_respiratory_admission ON nursing_respiratory(tenant_id, admission_id, is_active);
CREATE INDEX IF NOT EXISTS idx_nursing_respiratory_type ON nursing_respiratory(tenant_id, entry_type, is_active);
