-- Migration 0264: Create prescription_dose_templates table
-- Doctor-specific dose templates for quick prescription writing

CREATE TABLE IF NOT EXISTS prescription_dose_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  doctor_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  frequency TEXT,
  duration TEXT,
  instructions TEXT,
  is_default INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_dose_templates_doctor ON prescription_dose_templates(tenant_id, doctor_id);
CREATE INDEX IF NOT EXISTS idx_dose_templates_tenant ON prescription_dose_templates(tenant_id);
