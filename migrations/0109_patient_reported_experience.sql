CREATE TABLE IF NOT EXISTS global_patient_adverse_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uhid TEXT NOT NULL,
  medication_name TEXT NOT NULL,
  generic_name TEXT,
  reaction TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'moderate' CHECK(severity IN ('mild', 'moderate', 'severe')),
  onset_date TEXT,
  outcome_status TEXT CHECK(outcome_status IN ('ongoing', 'resolved', 'required_treatment', 'hospitalized')),
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'patient_reported',
  review_status TEXT NOT NULL DEFAULT 'pending_review' CHECK(review_status IN ('pending_review', 'verified', 'rejected')),
  reviewed_by INTEGER,
  reviewed_at TEXT,
  review_notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uhid) REFERENCES global_patient_identity(uhid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_global_patient_adverse_reactions_uhid ON global_patient_adverse_reactions(uhid);
CREATE INDEX IF NOT EXISTS idx_global_patient_adverse_reactions_review ON global_patient_adverse_reactions(review_status);

CREATE TABLE IF NOT EXISTS global_patient_lifestyle_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uhid TEXT NOT NULL,
  logged_on TEXT NOT NULL,
  sleep_hours REAL,
  exercise_minutes INTEGER,
  mood TEXT CHECK(mood IN ('very_low', 'low', 'neutral', 'good', 'excellent')),
  energy_level TEXT CHECK(energy_level IN ('very_low', 'low', 'moderate', 'high')),
  symptom_score INTEGER CHECK(symptom_score >= 0 AND symptom_score <= 10),
  symptoms TEXT,
  diet_notes TEXT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'patient_reported',
  review_status TEXT NOT NULL DEFAULT 'pending_review' CHECK(review_status IN ('pending_review', 'verified', 'rejected')),
  reviewed_by INTEGER,
  reviewed_at TEXT,
  review_notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uhid) REFERENCES global_patient_identity(uhid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_global_patient_lifestyle_logs_uhid ON global_patient_lifestyle_logs(uhid);
CREATE INDEX IF NOT EXISTS idx_global_patient_lifestyle_logs_logged_on ON global_patient_lifestyle_logs(logged_on);
CREATE INDEX IF NOT EXISTS idx_global_patient_lifestyle_logs_review ON global_patient_lifestyle_logs(review_status);
