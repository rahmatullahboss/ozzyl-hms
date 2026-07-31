-- Migration: Bengali language support + intake forms + emergency info
-- Sprint 3 features

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Bengali fields for website_config
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE website_config ADD COLUMN tagline_bn TEXT;
ALTER TABLE website_config ADD COLUMN about_text_bn TEXT;
ALTER TABLE website_config ADD COLUMN mission_text_bn TEXT;
ALTER TABLE website_config ADD COLUMN emergency_number TEXT;
ALTER TABLE website_config ADD COLUMN ambulance_number TEXT;
ALTER TABLE website_config ADD COLUMN emergency_hours TEXT DEFAULT '24/7';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Pre-appointment intake forms
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS appointment_intake_forms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    form_fields TEXT NOT NULL,  -- JSON array of field definitions
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appointment_intake_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    appointment_id INTEGER NOT NULL,
    form_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    responses TEXT NOT NULL,  -- JSON object of field_id → answer
    submitted_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (appointment_id) REFERENCES appointments(id),
    FOREIGN KEY (form_id) REFERENCES appointment_intake_forms(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

CREATE INDEX IF NOT EXISTS idx_intake_forms_tenant ON appointment_intake_forms(tenant_id);
CREATE INDEX IF NOT EXISTS idx_intake_responses_appt ON appointment_intake_responses(appointment_id);
CREATE INDEX IF NOT EXISTS idx_intake_responses_patient ON appointment_intake_responses(tenant_id, patient_id);
