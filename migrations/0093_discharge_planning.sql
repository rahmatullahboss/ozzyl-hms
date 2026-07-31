-- Migration: 0093_discharge_planning.sql
-- Discharge Planning Workflow — checklist, medication reconciliation, follow-up

CREATE TABLE IF NOT EXISTS discharge_checklists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    admission_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    -- Checklist items (1=done, 0=pending)
    vitals_stable INTEGER DEFAULT 0,
    medications_reconciled INTEGER DEFAULT 0,
    prescriptions_printed INTEGER DEFAULT 0,
    lab_results_reviewed INTEGER DEFAULT 0,
    pending_tests_cleared INTEGER DEFAULT 0,
    diet_instructions_given INTEGER DEFAULT 0,
    wound_care_instructions INTEGER DEFAULT 0,
    follow_up_scheduled INTEGER DEFAULT 0,
    referrals_arranged INTEGER DEFAULT 0,
    insurance_clearance INTEGER DEFAULT 0,
    billing_cleared INTEGER DEFAULT 0,
    belongings_returned INTEGER DEFAULT 0,
    transport_arranged INTEGER DEFAULT 0,
    patient_education_done INTEGER DEFAULT 0,
    consent_forms_signed INTEGER DEFAULT 0,
    -- Medication reconciliation
    discharge_medications TEXT,           -- JSON array of medications
    stopped_medications TEXT,             -- JSON array of stopped medications with reason
    new_medications TEXT,                 -- JSON array of newly added medications
    -- Follow-up
    follow_up_appointments TEXT,          -- JSON array: [{date, doctor, department, notes}]
    -- Instructions
    activity_restrictions TEXT,
    dietary_instructions TEXT,
    wound_care_notes TEXT,
    warning_signs TEXT,                   -- "Return to ER if..."
    emergency_contact_info TEXT,
    -- Status
    status TEXT DEFAULT 'in_progress' CHECK(status IN ('in_progress','ready','approved','discharged','cancelled')),
    planned_discharge_date TEXT,
    actual_discharge_date TEXT,
    discharge_type TEXT DEFAULT 'normal' CHECK(discharge_type IN ('normal','against_medical_advice','transfer','expired','absconded')),
    approved_by INTEGER,
    approved_at TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (admission_id) REFERENCES admissions(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dc_admission ON discharge_checklists(tenant_id, admission_id);
CREATE INDEX IF NOT EXISTS idx_dc_tenant ON discharge_checklists(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_dc_patient ON discharge_checklists(tenant_id, patient_id);
