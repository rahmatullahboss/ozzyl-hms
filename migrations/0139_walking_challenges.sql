-- Migration: Walking Challenges
-- Sprint 3.4 — Task 16

CREATE TABLE IF NOT EXISTS walking_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'steps',    -- steps, distance_km
  target INTEGER NOT NULL,               -- total target (e.g. 70000 steps)
  duration_days INTEGER NOT NULL,
  created_by INTEGER NOT NULL,           -- patient_id
  status TEXT DEFAULT 'active',          -- active, completed, expired
  start_date TEXT DEFAULT (date('now')),
  end_date TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS challenge_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge_id INTEGER NOT NULL REFERENCES walking_challenges(id),
  patient_id INTEGER NOT NULL,
  current_value INTEGER DEFAULT 0,
  joined_at TEXT DEFAULT (datetime('now')),
  UNIQUE(challenge_id, patient_id)
);

CREATE INDEX IF NOT EXISTS idx_challenges_status ON walking_challenges(status);
CREATE INDEX IF NOT EXISTS idx_challenge_parts ON challenge_participants(challenge_id, patient_id);
