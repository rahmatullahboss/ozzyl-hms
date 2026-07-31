-- Onboarding progression tracking (first-week guided experience)
CREATE TABLE IF NOT EXISTS onboarding_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  day INTEGER NOT NULL CHECK(day >= 1 AND day <= 7),
  completed_at TEXT DEFAULT (datetime('now')),
  UNIQUE(patient_id, day),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_progress_patient ON onboarding_progress(patient_id);
