CREATE TABLE IF NOT EXISTS global_patient_vitals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uhid TEXT NOT NULL,
  logged_on TEXT NOT NULL,
  systolic INTEGER,
  diastolic INTEGER,
  heart_rate INTEGER,
  blood_sugar REAL,
  blood_sugar_context TEXT CHECK(blood_sugar_context IN ('fasting', 'post_prandial', 'random')),
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'patient_reported',
  review_status TEXT NOT NULL DEFAULT 'pending_review',
  reviewed_at TEXT,
  review_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
