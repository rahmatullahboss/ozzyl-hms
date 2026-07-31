-- Migration: Emergency Department Module
-- Ported from danphe-next-cloudflare (0012_emergency.sql)
-- Adapted for HMS SaaS multi-tenant pattern (tenant_id, snake_case)

-- ============================================================
-- Mode of arrival lookup table
-- ============================================================
CREATE TABLE IF NOT EXISTS er_mode_of_arrival (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);

-- ============================================================
-- Main Emergency Patient Registration
-- ============================================================
CREATE TABLE IF NOT EXISTS er_patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    er_patient_number TEXT NOT NULL,
    patient_id INTEGER,
    visit_id INTEGER,
    discharge_summary_id INTEGER,
    visit_datetime TEXT,
    first_name TEXT,
    middle_name TEXT,
    last_name TEXT,
    gender TEXT,
    age TEXT,
    date_of_birth TEXT,
    contact_no TEXT,
    care_of_person_contact TEXT,
    address TEXT,
    referred_by TEXT,
    referred_to TEXT,
    case_type TEXT,
    condition_on_arrival TEXT,
    brought_by TEXT,
    relation_with_patient TEXT,
    mode_of_arrival_id INTEGER,
    care_of_person TEXT,
    er_status TEXT DEFAULT 'new',          -- new, triaged, finalized
    triage_code TEXT,                       -- red, yellow, green
    triaged_by INTEGER,
    triaged_on TEXT,
    is_active INTEGER DEFAULT 1,
    is_existing_patient INTEGER DEFAULT 0,
    ward_no INTEGER,
    finalized_status TEXT,                  -- admitted, discharged, lama, dor, transferred, death
    finalized_remarks TEXT,
    finalized_by INTEGER,
    finalized_on TEXT,
    performer_id INTEGER,
    performer_name TEXT,
    is_police_case INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (visit_id) REFERENCES visits(id),
    FOREIGN KEY (mode_of_arrival_id) REFERENCES er_mode_of_arrival(id)
);

-- ============================================================
-- Emergency Discharge Summary
-- ============================================================
CREATE TABLE IF NOT EXISTS er_discharge_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    visit_id INTEGER NOT NULL,
    discharge_type TEXT,
    chief_complaints TEXT,
    treatment_in_er TEXT,
    investigations TEXT,
    advice_on_discharge TEXT,
    on_examination TEXT,
    provisional_diagnosis TEXT,
    doctor_name TEXT,
    medical_officer TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (visit_id) REFERENCES visits(id)
);

-- ============================================================
-- Special case tracking (animal bites, trauma, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS er_patient_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    er_patient_id INTEGER NOT NULL,
    main_case INTEGER,
    sub_case INTEGER,
    other_case_details TEXT,
    biting_site INTEGER,
    datetime_of_bite TEXT,
    biting_animal INTEGER,
    first_aid INTEGER,
    first_aid_others TEXT,
    biting_animal_others TEXT,
    biting_site_others TEXT,
    biting_address TEXT,
    biting_animal_name TEXT,
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (er_patient_id) REFERENCES er_patients(id)
);

-- ============================================================
-- Consent form / file uploads (R2 URLs)
-- ============================================================
CREATE TABLE IF NOT EXISTS er_file_uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    er_patient_id INTEGER NOT NULL,
    patient_id INTEGER,
    file_type TEXT,
    file_name TEXT,
    display_name TEXT,
    file_url TEXT,
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (er_patient_id) REFERENCES er_patients(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

-- ============================================================
-- Performance Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_er_patients_tenant ON er_patients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_er_patients_number ON er_patients(tenant_id, er_patient_number);
CREATE INDEX IF NOT EXISTS idx_er_patients_patient ON er_patients(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_er_patients_status ON er_patients(tenant_id, er_status);
CREATE INDEX IF NOT EXISTS idx_er_patients_triage ON er_patients(tenant_id, triage_code);
CREATE INDEX IF NOT EXISTS idx_er_patients_finalized ON er_patients(tenant_id, finalized_status);
CREATE INDEX IF NOT EXISTS idx_er_patients_visit_date ON er_patients(tenant_id, visit_datetime);
CREATE INDEX IF NOT EXISTS idx_er_patients_active ON er_patients(tenant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_er_discharge_tenant ON er_discharge_summaries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_er_discharge_patient ON er_discharge_summaries(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_er_discharge_visit ON er_discharge_summaries(tenant_id, visit_id);

CREATE INDEX IF NOT EXISTS idx_er_cases_patient ON er_patient_cases(tenant_id, er_patient_id);
CREATE INDEX IF NOT EXISTS idx_er_files_patient ON er_file_uploads(tenant_id, er_patient_id);

CREATE INDEX IF NOT EXISTS idx_er_arrival_tenant ON er_mode_of_arrival(tenant_id);
