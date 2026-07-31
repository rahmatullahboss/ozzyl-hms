-- Migration: Advanced Billing System
-- Credit Notes, Cancellations, IP Billing, Insurance Claims, Settlements, Handover
-- Ported from danphe-next-cloudflare, adapted for HMS SaaS multi-tenancy

-- ============================================================
-- Credit Notes (refunds/returns against invoices)
-- ============================================================
CREATE TABLE IF NOT EXISTS billing_credit_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    credit_note_no TEXT NOT NULL,
    bill_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    total_amount REAL NOT NULL DEFAULT 0,
    refund_amount REAL NOT NULL DEFAULT 0,
    payment_mode TEXT,
    remarks TEXT,
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS billing_credit_note_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    credit_note_id INTEGER NOT NULL,
    invoice_item_id INTEGER NOT NULL,
    item_name TEXT,
    unit_price REAL,
    return_quantity INTEGER NOT NULL DEFAULT 1,
    total_amount REAL NOT NULL DEFAULT 0,
    remarks TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- IP Billing (inpatient pending charges)
-- ============================================================
CREATE TABLE IF NOT EXISTS billing_provisional_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    admission_id INTEGER,
    visit_id INTEGER,
    item_category TEXT NOT NULL,
    item_name TEXT NOT NULL,
    department TEXT,
    unit_price REAL NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    discount_percent REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    total_amount REAL NOT NULL DEFAULT 0,
    doctor_id INTEGER,
    doctor_name TEXT,
    reference_id INTEGER,
    bill_status TEXT DEFAULT 'provisional',
    is_insurance INTEGER DEFAULT 0,
    cancelled_by INTEGER,
    cancelled_at TEXT,
    cancel_reason TEXT,
    billed_bill_id INTEGER,
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- Insurance
-- ============================================================
CREATE TABLE IF NOT EXISTS insurance_schemes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    scheme_name TEXT NOT NULL,
    scheme_code TEXT,
    scheme_type TEXT DEFAULT 'insurance',
    contact TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS patient_insurance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    scheme_id INTEGER NOT NULL,
    policy_no TEXT,
    member_id TEXT,
    valid_from TEXT,
    valid_to TEXT,
    credit_limit REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- insurance_claims already exists from earlier migration (0023)
-- We'll use the existing table and adapt routes to its schema

-- ============================================================
-- Settlements (credit bill payment collection)
-- ============================================================
CREATE TABLE IF NOT EXISTS billing_settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    settlement_receipt_no TEXT NOT NULL,
    payable_amount REAL NOT NULL DEFAULT 0,
    paid_amount REAL NOT NULL DEFAULT 0,
    deposit_deducted REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    returned_amount REAL DEFAULT 0,
    payment_mode TEXT,
    remarks TEXT,
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- Cash Handover (cashier shift management)
-- ============================================================
CREATE TABLE IF NOT EXISTS billing_handovers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    handover_type TEXT DEFAULT 'cashier',
    handover_by INTEGER NOT NULL,
    handover_to INTEGER,
    handover_amount REAL NOT NULL DEFAULT 0,
    due_amount REAL DEFAULT 0,
    remarks TEXT,
    status TEXT DEFAULT 'pending',
    received_by INTEGER,
    received_at TEXT,
    received_remarks TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- Performance Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_credit_notes_tenant ON billing_credit_notes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_bill ON billing_credit_notes(tenant_id, bill_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_patient ON billing_credit_notes(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_credit_note_items_cn ON billing_credit_note_items(credit_note_id);
CREATE INDEX IF NOT EXISTS idx_provisional_tenant ON billing_provisional_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_provisional_patient ON billing_provisional_items(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_provisional_admission ON billing_provisional_items(tenant_id, admission_id);
CREATE INDEX IF NOT EXISTS idx_provisional_status ON billing_provisional_items(tenant_id, bill_status);
CREATE INDEX IF NOT EXISTS idx_ins_schemes_tenant ON insurance_schemes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_patient_ins_tenant ON patient_insurance(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_settlements_tenant ON billing_settlements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_settlements_patient ON billing_settlements(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_handovers_tenant ON billing_handovers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_handovers_by ON billing_handovers(tenant_id, handover_by);
