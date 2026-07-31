-- Migration: Normalized wellness log tables for OzzyLife health score engine
-- Sprint 1.3 - Task 13

CREATE TABLE IF NOT EXISTS mood_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  mood TEXT NOT NULL CHECK(mood IN ('great', 'good', 'okay', 'low', 'struggling')),
  energy_level INTEGER CHECK(energy_level >= 1 AND energy_level <= 10),
  note TEXT,
  tags TEXT,
  logged_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id)
);
CREATE INDEX IF NOT EXISTS idx_mood_log_patient ON mood_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_mood_log_patient_date ON mood_log(patient_id, date(logged_at));

CREATE TABLE IF NOT EXISTS sleep_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  bedtime TEXT,
  wake_time TEXT,
  duration_min INTEGER,
  quality_rating INTEGER CHECK(quality_rating >= 1 AND quality_rating <= 5),
  sleep_stages TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'wearable')),
  logged_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id)
);
CREATE INDEX IF NOT EXISTS idx_sleep_log_patient ON sleep_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_sleep_log_patient_date ON sleep_log(patient_id, date(logged_at));

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  activity_type TEXT NOT NULL CHECK(activity_type IN ('walk', 'run', 'cycle', 'gym', 'yoga', 'namaz', 'housework', 'swim', 'other')),
  duration_min INTEGER NOT NULL,
  calories_burned INTEGER,
  steps INTEGER,
  distance_m REAL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'wearable')),
  started_at TEXT,
  ended_at TEXT,
  logged_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id)
);
CREATE INDEX IF NOT EXISTS idx_activity_log_patient ON activity_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_patient_date ON activity_log(patient_id, date(logged_at));

CREATE TABLE IF NOT EXISTS water_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  amount_ml INTEGER NOT NULL,
  logged_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id)
);
CREATE INDEX IF NOT EXISTS idx_water_log_patient ON water_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_water_log_patient_date ON water_log(patient_id, date(logged_at));

CREATE TABLE IF NOT EXISTS symptom_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  symptom TEXT NOT NULL,
  severity INTEGER CHECK(severity >= 1 AND severity <= 10),
  note TEXT,
  logged_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id)
);
CREATE INDEX IF NOT EXISTS idx_symptom_log_patient ON symptom_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_symptom_log_patient_date ON symptom_log(patient_id, date(logged_at));
