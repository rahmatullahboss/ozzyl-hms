-- Migration: Wellness profile, preferences, health score, streaks, goals, achievements
-- OzzyLife Phase 1 - Sprint 1.1

-- ─── Wellness Profile ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wellness_profile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL UNIQUE,
  date_of_birth TEXT,
  gender TEXT CHECK(gender IN ('male','female','other')),
  height_cm REAL,
  weight_kg REAL,
  language TEXT DEFAULT 'bn',
  timezone TEXT DEFAULT 'Asia/Dhaka',
  onboarding_completed INTEGER DEFAULT 0,
  ramadan_mode INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id)
);

-- ─── Wellness Preferences ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wellness_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL UNIQUE,
  notification_settings TEXT DEFAULT '{}',
  active_modules TEXT DEFAULT '["activity","sleep","mood"]',
  daily_goals TEXT DEFAULT '{"steps":6000,"water_glasses":8,"sleep_hours":7}',
  units TEXT DEFAULT '{"weight":"kg","height":"cm","glucose":"mmol","temp":"F"}',
  quiet_hours_start TEXT DEFAULT '22:00',
  quiet_hours_end TEXT DEFAULT '07:00',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id)
);

-- ─── Daily Health Score ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_health_score (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  total_score INTEGER NOT NULL CHECK(total_score >= 0 AND total_score <= 100),
  sleep_score INTEGER DEFAULT 0,
  activity_score INTEGER DEFAULT 0,
  nutrition_score INTEGER DEFAULT 0,
  mood_score INTEGER DEFAULT 0,
  medication_score INTEGER DEFAULT 0,
  vitals_score INTEGER DEFAULT 0,
  breakdown_json TEXT DEFAULT '{}',
  calculated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(patient_id, date),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id)
);
CREATE INDEX IF NOT EXISTS idx_health_score_patient_date ON daily_health_score(patient_id, date);

-- ─── Streaks ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS streaks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  streak_type TEXT NOT NULL CHECK(streak_type IN ('daily_checkin','food_log','activity','sleep_log','medication','water')),
  current_count INTEGER DEFAULT 0,
  longest_count INTEGER DEFAULT 0,
  last_logged_date TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  UNIQUE(patient_id, streak_type),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id)
);

-- ─── User Goals ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  goal_type TEXT NOT NULL,
  target_value REAL NOT NULL,
  current_value REAL DEFAULT 0,
  unit TEXT,
  start_date TEXT DEFAULT (date('now')),
  end_date TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','abandoned')),
  ai_suggested INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id)
);

-- ─── Achievements ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS achievements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  achievement_key TEXT NOT NULL,
  earned_at TEXT DEFAULT (datetime('now')),
  UNIQUE(patient_id, achievement_key),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id)
);
