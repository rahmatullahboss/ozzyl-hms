-- Migration: Enhanced Nursing Module
-- Ported from danphe-next-cloudflare (0032_nursing + 0034_nursing_opd + 0039_nursing_handover)
-- Adapted for HMS SaaS multi-tenant pattern (tenant_id, snake_case)

-- ============================================================
-- 1. Nursing Care Plan
-- ============================================================
CREATE TABLE IF NOT EXISTS nur_care_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    visit_id INTEGER NOT NULL,
    problem TEXT,
    goal TEXT,
    intervention TEXT,
    evaluation TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_by INTEGER,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_nur_care_plans_tenant ON nur_care_plans(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nur_care_plans_visit ON nur_care_plans(tenant_id, visit_id);
CREATE INDEX IF NOT EXISTS idx_nur_care_plans_patient ON nur_care_plans(tenant_id, patient_id);

-- ============================================================
-- 2. Nursing Notes
-- ============================================================
CREATE TABLE IF NOT EXISTS nur_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    visit_id INTEGER NOT NULL,
    note_type TEXT NOT NULL,           -- 'Progress', 'Handover', 'Incident'
    note TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_by INTEGER,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_nur_notes_tenant ON nur_notes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nur_notes_visit ON nur_notes(tenant_id, visit_id);

-- ============================================================
-- 3. Medication Administration Record (MAR)
-- ============================================================
CREATE TABLE IF NOT EXISTS nur_medication_admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    visit_id INTEGER NOT NULL,
    medication_name TEXT NOT NULL,
    dose TEXT,
    route TEXT,
    frequency TEXT,
    administered_on TEXT DEFAULT (datetime('now')),
    administered_by INTEGER,
    remarks TEXT,
    status TEXT DEFAULT 'given',       -- 'given', 'missed', 'refused'
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_by INTEGER,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_nur_mar_tenant ON nur_medication_admin(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nur_mar_visit ON nur_medication_admin(tenant_id, visit_id);
CREATE INDEX IF NOT EXISTS idx_nur_mar_patient ON nur_medication_admin(tenant_id, patient_id);

-- ============================================================
-- 4. Intake/Output Chart
-- ============================================================
CREATE TABLE IF NOT EXISTS nur_intake_output (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    visit_id INTEGER NOT NULL,
    intake_type TEXT,                  -- 'Oral', 'IV', 'Tube'
    intake_amount REAL,
    intake_unit TEXT DEFAULT 'ml',
    output_type TEXT,                  -- 'Urine', 'Stool', 'Drain', 'Vomit'
    output_amount REAL,
    output_unit TEXT DEFAULT 'ml',
    remarks TEXT,
    recorded_on TEXT DEFAULT (datetime('now')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_by INTEGER,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_nur_io_tenant ON nur_intake_output(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nur_io_visit ON nur_intake_output(tenant_id, visit_id);

-- ============================================================
-- 5. Patient Monitoring (Observations)
-- ============================================================
CREATE TABLE IF NOT EXISTS nur_patient_monitoring (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    visit_id INTEGER NOT NULL,
    temperature REAL,
    temperature_unit TEXT DEFAULT 'F',
    pulse INTEGER,
    respiration INTEGER,
    bp_systolic INTEGER,
    bp_diastolic INTEGER,
    spo2 REAL,
    pain_scale INTEGER,
    remarks TEXT,
    recorded_on TEXT DEFAULT (datetime('now')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_by INTEGER,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_nur_monitoring_tenant ON nur_patient_monitoring(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nur_monitoring_visit ON nur_patient_monitoring(tenant_id, visit_id);

-- ============================================================
-- 6. IV Drug Management
-- ============================================================
CREATE TABLE IF NOT EXISTS nur_iv_drugs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    visit_id INTEGER NOT NULL,
    drug_name TEXT NOT NULL,
    dosing TEXT,
    rate TEXT,                         -- e.g. "100ml/hr"
    start_time TEXT,
    end_time TEXT,
    status TEXT DEFAULT 'running',     -- 'running', 'paused', 'stopped', 'completed'
    note TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_by INTEGER,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_nur_iv_tenant ON nur_iv_drugs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nur_iv_visit ON nur_iv_drugs(tenant_id, visit_id);

-- ============================================================
-- 7. Wound Care
-- ============================================================
CREATE TABLE IF NOT EXISTS nur_wound_care (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    visit_id INTEGER NOT NULL,
    wound_site TEXT,
    wound_type TEXT,
    size TEXT,                         -- e.g. "5x4 cm"
    depth TEXT,
    exudate TEXT,                      -- 'Purulent', 'Serous', etc.
    description TEXT,
    treatment TEXT,
    next_dressing_due TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_by INTEGER,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_nur_wound_tenant ON nur_wound_care(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nur_wound_visit ON nur_wound_care(tenant_id, visit_id);

-- ============================================================
-- 8. Nursing Clinical Handover / Shift Report
-- ============================================================
CREATE TABLE IF NOT EXISTS nur_handover (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    visit_id INTEGER NOT NULL,
    shift TEXT NOT NULL,               -- 'Morning', 'Evening', 'Night'
    given_by INTEGER,                  -- employee_id
    taken_by INTEGER,                  -- employee_id
    content TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_by INTEGER,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_nur_handover_tenant ON nur_handover(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nur_handover_visit ON nur_handover(tenant_id, visit_id);
CREATE INDEX IF NOT EXISTS idx_nur_handover_patient ON nur_handover(tenant_id, patient_id);

-- ============================================================
-- 9. Patient Clinical Info (Key-Value Store for Triage)
-- ============================================================
CREATE TABLE IF NOT EXISTS cln_patient_clinical_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    visit_id INTEGER NOT NULL,
    key_name TEXT,                     -- e.g. "Complaint", "History"
    value TEXT,
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_by INTEGER,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cln_info_tenant ON cln_patient_clinical_info(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cln_info_visit ON cln_patient_clinical_info(tenant_id, visit_id);

-- ============================================================
-- 10. Employee Preferences (Nurse Favorites)
-- ============================================================
CREATE TABLE IF NOT EXISTS emp_employee_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    employee_id INTEGER NOT NULL,
    preference_name TEXT NOT NULL,     -- "NursingPatientPreferences"
    preference_value TEXT,
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_by INTEGER,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_emp_pref_tenant ON emp_employee_preferences(tenant_id);
CREATE INDEX IF NOT EXISTS idx_emp_pref_employee ON emp_employee_preferences(tenant_id, employee_id);
