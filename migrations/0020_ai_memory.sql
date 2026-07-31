-- AI Interactions & Feedback Table
-- Stores every AI suggestion + doctor's response (accepted/rejected/modified)
-- This enables the AI to learn from doctor preferences over time

CREATE TABLE IF NOT EXISTS ai_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  feature TEXT NOT NULL,           -- 'prescription_assist', 'diagnosis_suggest', etc.
  input_summary TEXT NOT NULL,     -- concise summary of what was asked
  ai_response TEXT NOT NULL,       -- full AI response (JSON)
  user_action TEXT DEFAULT 'pending', -- 'accepted', 'rejected', 'modified', 'pending'
  user_modification TEXT,          -- what the doctor changed (if modified)
  vector_id TEXT,                  -- ID in Vectorize for similarity search
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_interactions_tenant ON ai_interactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_user ON ai_interactions(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_feature ON ai_interactions(tenant_id, feature);

-- Doctor Preferences Table
-- Stores learned preferences per doctor (e.g., "prefers Tab Napa over Paracetamol")
CREATE TABLE IF NOT EXISTS ai_doctor_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  doctor_id TEXT NOT NULL,
  preference_type TEXT NOT NULL,   -- 'medication_preference', 'diagnosis_pattern', etc.
  preference_key TEXT NOT NULL,    -- e.g., drug name, symptom pattern
  preference_value TEXT NOT NULL,  -- e.g., preferred alternative, common diagnosis
  frequency INTEGER DEFAULT 1,    -- how many times this pattern was observed
  last_used_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_doc_pref_unique
  ON ai_doctor_preferences(tenant_id, doctor_id, preference_type, preference_key);

CREATE INDEX IF NOT EXISTS idx_ai_doc_pref_doctor
  ON ai_doctor_preferences(tenant_id, doctor_id);
