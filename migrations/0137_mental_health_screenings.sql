-- Migration: Create mental_health_screenings table
-- Sprint 3.3 — Task 7: PHQ-9 & GAD-7 Screening

CREATE TABLE IF NOT EXISTS mental_health_screenings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  screening_type TEXT NOT NULL,   -- phq9, gad7
  answers TEXT NOT NULL,           -- JSON array of integers
  total_score INTEGER NOT NULL,
  severity TEXT NOT NULL,          -- none, minimal, mild, moderate, moderately_severe, severe
  suicidal_risk INTEGER DEFAULT 0, -- 1 if PHQ-9 Q9 > 0
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mh_screenings_patient ON mental_health_screenings(patient_id, screening_type);
CREATE INDEX IF NOT EXISTS idx_mh_screenings_date ON mental_health_screenings(patient_id, created_at);
