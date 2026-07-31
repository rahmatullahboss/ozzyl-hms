DROP TABLE IF EXISTS ai_action_items;
-- Migration: Hospital linking and clinical consent tables
-- Phase 2.2

-- ─── Hospital Links ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hospital_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  hospital_name TEXT NOT NULL,
  patient_record_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'pending', 'revoked')),
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id),
  UNIQUE(patient_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_hospital_links_patient ON hospital_links(patient_id, status);

-- ─── Clinical Consents ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clinical_consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  consent_type TEXT NOT NULL CHECK(consent_type IN ('ai_access', 'mood_sharing', 'cycle_sharing', 'vitals_sharing', 'medication_sharing', 'lab_sharing')),
  granted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id),
  UNIQUE(patient_id, tenant_id, consent_type)
);

CREATE INDEX IF NOT EXISTS idx_clinical_consents_patient ON clinical_consents(patient_id, tenant_id);

-- ─── Clinical Cache (offline support) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS clinical_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  data_type TEXT NOT NULL,
  data_json TEXT NOT NULL,
  cached_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id)
);

CREATE INDEX IF NOT EXISTS idx_clinical_cache_patient ON clinical_cache(patient_id, tenant_id, data_type);

-- ─── User Medications (hospital-synced + manual) ─────────────────────
CREATE TABLE IF NOT EXISTS user_medications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  medication_name TEXT NOT NULL,
  dosage TEXT,
  frequency TEXT,
  times_of_day TEXT,
  start_date TEXT,
  end_date TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'hospital')),
  hospital_prescription_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id)
);

CREATE INDEX IF NOT EXISTS idx_user_medications_patient ON user_medications(patient_id, active);

-- ─── AI Action Items (pre/post visit) ────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_action_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  insight_id INTEGER,
  action_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'dismissed')),
  due_date TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id),
  FOREIGN KEY (insight_id) REFERENCES ai_insights(id)
);

CREATE INDEX IF NOT EXISTS idx_ai_action_items_patient ON ai_action_items(patient_id, status);
