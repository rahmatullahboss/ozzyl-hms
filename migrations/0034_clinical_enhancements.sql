-- Migration: Billing Deposits, Clinical Vitals & Allergies
-- Ported from danphe-next-cloudflare and adapted for HMS SaaS

-- ============================================================
-- Billing Deposits (advance payment for IPD)
-- ============================================================
CREATE TABLE IF NOT EXISTS billing_deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    deposit_receipt_no TEXT NOT NULL,
    amount REAL NOT NULL,
    transaction_type TEXT NOT NULL DEFAULT 'deposit',  -- deposit, refund, adjustment
    payment_method TEXT,                                -- cash, card, bkash, nagad, bank
    remarks TEXT,
    reference_bill_id INTEGER,                          -- linked bill for adjustments
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (reference_bill_id) REFERENCES bills(id)
);

-- ============================================================
-- Clinical Vitals
-- ============================================================
CREATE TABLE IF NOT EXISTS clinical_vitals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    visit_id INTEGER,
    temperature REAL,            -- °F
    pulse INTEGER,               -- bpm
    blood_pressure_systolic INTEGER,
    blood_pressure_diastolic INTEGER,
    respiratory_rate INTEGER,    -- breaths/min
    spo2 REAL,                   -- %
    weight REAL,                 -- kg
    height REAL,                 -- cm
    bmi REAL,                    -- auto-calc
    pain_scale INTEGER,          -- 0-10
    blood_sugar REAL,            -- mg/dL
    notes TEXT,
    taken_by INTEGER,
    taken_at TEXT DEFAULT (datetime('now')),
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (visit_id) REFERENCES visits(id)
);

-- ============================================================
-- Patient Allergies
-- ============================================================
CREATE TABLE IF NOT EXISTS patient_allergies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    allergy_type TEXT NOT NULL,             -- drug, food, environmental, other
    allergen TEXT NOT NULL,                 -- what they're allergic to
    severity TEXT DEFAULT 'mild',           -- mild, moderate, severe, life_threatening
    reaction TEXT,                          -- rash, anaphylaxis, etc.
    onset_date TEXT,
    notes TEXT,
    is_active INTEGER DEFAULT 1,
    verified_by INTEGER,
    verified_at TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

-- ============================================================
-- Performance Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_deposits_tenant ON billing_deposits(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deposits_patient ON billing_deposits(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_deposits_type ON billing_deposits(tenant_id, transaction_type);
CREATE INDEX IF NOT EXISTS idx_deposits_receipt ON billing_deposits(tenant_id, deposit_receipt_no);

CREATE INDEX IF NOT EXISTS idx_vitals_tenant ON clinical_vitals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vitals_patient ON clinical_vitals(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_vitals_visit ON clinical_vitals(tenant_id, visit_id);
CREATE INDEX IF NOT EXISTS idx_vitals_taken_at ON clinical_vitals(tenant_id, taken_at);

CREATE INDEX IF NOT EXISTS idx_allergies_tenant ON patient_allergies(tenant_id);
CREATE INDEX IF NOT EXISTS idx_allergies_patient ON patient_allergies(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_allergies_type ON patient_allergies(tenant_id, allergy_type);
