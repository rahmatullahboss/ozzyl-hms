-- Migration 0267: Create advice_templates table
-- Predefined advice templates for quick prescription writing

CREATE TABLE IF NOT EXISTS advice_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  doctor_id INTEGER,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  language TEXT DEFAULT 'bn',
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_advice_templates_tenant ON advice_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_advice_templates_doctor ON advice_templates(tenant_id, doctor_id);
