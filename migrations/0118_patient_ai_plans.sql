CREATE TABLE IF NOT EXISTS patient_ai_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  global_user_id INTEGER NOT NULL,
  uhid TEXT NOT NULL,
  patient_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,
  confidence TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  source_snapshot_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_patient_ai_plans_user_created
  ON patient_ai_plans(global_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_ai_plans_uhid_created
  ON patient_ai_plans(uhid, created_at DESC);
