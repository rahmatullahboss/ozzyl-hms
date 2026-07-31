CREATE TABLE IF NOT EXISTS patient_ai_plan_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  global_user_id INTEGER NOT NULL,
  completed_items_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(plan_id, global_user_id)
);

CREATE INDEX IF NOT EXISTS idx_patient_ai_plan_progress_user_plan
  ON patient_ai_plan_progress(global_user_id, plan_id);
