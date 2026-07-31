-- Migration: Create wearable_samples table for HealthKit/Health Connect sync
-- Sprint 3.2 — Tasks 4-5: Wearable Integration

CREATE TABLE IF NOT EXISTS wearable_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  sample_type TEXT NOT NULL,  -- steps, heart_rate, sleep_minutes, spo2, active_calories, exercise_minutes, distance_m, resting_heart_rate, stand_hours
  value REAL NOT NULL,
  date TEXT NOT NULL,          -- YYYY-MM-DD
  timestamp TEXT NOT NULL,     -- ISO 8601
  device_name TEXT,
  platform TEXT,               -- ios, android
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for fast daily aggregation queries
CREATE INDEX IF NOT EXISTS idx_wearable_patient_date ON wearable_samples(patient_id, date);
CREATE INDEX IF NOT EXISTS idx_wearable_patient_date_type ON wearable_samples(patient_id, date, sample_type);
