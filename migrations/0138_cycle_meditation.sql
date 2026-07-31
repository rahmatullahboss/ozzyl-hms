-- Migration: Create tables for cycle tracking and meditation logging
-- Sprint 3.3 — Tasks 9, 11

-- Cycle tracking (Task 11)
CREATE TABLE IF NOT EXISTS cycle_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,       -- YYYY-MM-DD
  end_date TEXT,                   -- YYYY-MM-DD (null if still ongoing)
  flow_intensity TEXT,             -- light, medium, heavy
  symptoms TEXT,                   -- JSON array
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cycle_logs_patient ON cycle_logs(patient_id, start_date);

-- Meditation sessions (Task 9)
CREATE TABLE IF NOT EXISTS meditation_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  type TEXT DEFAULT 'unguided',    -- unguided, guided, breathing
  mood_before TEXT,
  mood_after TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_meditation_patient ON meditation_sessions(patient_id, created_at);
