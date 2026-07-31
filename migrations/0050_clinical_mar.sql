-- Migration: 0050_clinical_mar.sql
-- Description: Clinical-grade Medication Administration Record (MAR)
-- Bridges e-prescribing → nursing MAR via clinical medication orders
-- Created: 2026-03-18

-- ===================================================================
-- 1. Clinical Medication Orders (CPOE bridge)
-- Doctors place orders → nurses administer via MAR
-- ===================================================================
CREATE TABLE IF NOT EXISTS cln_medication_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    patient_id INTEGER NOT NULL,
    visit_id INTEGER NOT NULL,

    -- Medication details (linked to formulary when possible)
    formulary_item_id INTEGER,
    medication_name TEXT NOT NULL,
    generic_name TEXT,
    strength TEXT,
    dosage_form TEXT,

    -- Order details
    dose TEXT NOT NULL,                    -- e.g. "500mg", "1 tablet"
    route TEXT NOT NULL DEFAULT 'Oral',    -- Oral, IV, IM, SC, Topical, Inhalation, Sublingual
    frequency TEXT NOT NULL,              -- e.g. "TDS", "BD", "QID", "1+0+1", "PRN"
    duration TEXT,                         -- e.g. "5 days", "Ongoing"
    instructions TEXT,                     -- e.g. "After food", "Before sleep"
    priority TEXT NOT NULL DEFAULT 'routine'
        CHECK (priority IN ('stat', 'urgent', 'routine', 'prn')),

    -- Schedule
    start_datetime TEXT NOT NULL DEFAULT (datetime('now')),
    end_datetime TEXT,

    -- Order lifecycle
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'discontinued', 'on_hold', 'cancelled')),
    status_reason TEXT,                    -- Why discontinued/held

    -- Audit
    ordered_by INTEGER NOT NULL,           -- doctor who placed the order
    verified_by INTEGER,                   -- pharmacist verification (if applicable)
    verified_at TEXT,
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,

    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (formulary_item_id) REFERENCES formulary_items(id)
);

CREATE INDEX IF NOT EXISTS idx_cln_med_orders_tenant ON cln_medication_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cln_med_orders_patient ON cln_medication_orders(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_cln_med_orders_visit ON cln_medication_orders(tenant_id, visit_id);
CREATE INDEX IF NOT EXISTS idx_cln_med_orders_status ON cln_medication_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_cln_med_orders_formulary ON cln_medication_orders(tenant_id, formulary_item_id);

-- ===================================================================
-- 2. Medication Reconciliation (Admission/Transfer/Discharge)
-- ===================================================================
CREATE TABLE IF NOT EXISTS cln_medication_reconciliation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    patient_id INTEGER NOT NULL,
    visit_id INTEGER NOT NULL,

    reconciliation_type TEXT NOT NULL
        CHECK (reconciliation_type IN ('admission', 'transfer', 'discharge')),
    status TEXT NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'completed', 'cancelled')),

    -- Who performed
    performed_by INTEGER NOT NULL,
    completed_at TEXT,
    notes TEXT,

    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,

    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

CREATE INDEX IF NOT EXISTS idx_cln_recon_tenant ON cln_medication_reconciliation(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cln_recon_patient ON cln_medication_reconciliation(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_cln_recon_visit ON cln_medication_reconciliation(tenant_id, visit_id);

-- ===================================================================
-- 3. Medication Reconciliation Items
-- ===================================================================
CREATE TABLE IF NOT EXISTS cln_medication_reconciliation_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    reconciliation_id INTEGER NOT NULL,

    medication_name TEXT NOT NULL,
    generic_name TEXT,
    dose TEXT,
    route TEXT,
    frequency TEXT,
    source TEXT DEFAULT 'home'
        CHECK (source IN ('home', 'inpatient', 'new')),
    action TEXT NOT NULL DEFAULT 'continue'
        CHECK (action IN ('continue', 'modify', 'discontinue', 'add')),
    action_reason TEXT,

    -- If modify: what changed
    new_dose TEXT,
    new_route TEXT,
    new_frequency TEXT,

    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (reconciliation_id) REFERENCES cln_medication_reconciliation(id)
);

CREATE INDEX IF NOT EXISTS idx_cln_recon_items_recon ON cln_medication_reconciliation_items(reconciliation_id);

-- ===================================================================
-- 4. ALTER existing nur_medication_admin — add order linkage + scheduling
-- ===================================================================
ALTER TABLE nur_medication_admin ADD COLUMN order_id INTEGER REFERENCES cln_medication_orders(id);
ALTER TABLE nur_medication_admin ADD COLUMN formulary_item_id INTEGER REFERENCES formulary_items(id);
ALTER TABLE nur_medication_admin ADD COLUMN generic_name TEXT;
ALTER TABLE nur_medication_admin ADD COLUMN strength TEXT;
ALTER TABLE nur_medication_admin ADD COLUMN scheduled_time TEXT;
ALTER TABLE nur_medication_admin ADD COLUMN actual_time TEXT;
ALTER TABLE nur_medication_admin ADD COLUMN reason_not_given TEXT;
ALTER TABLE nur_medication_admin ADD COLUMN barcode_scanned INTEGER DEFAULT 0;

-- Index on order linkage
CREATE INDEX IF NOT EXISTS idx_nur_mar_order ON nur_medication_admin(order_id);
CREATE INDEX IF NOT EXISTS idx_nur_mar_scheduled ON nur_medication_admin(tenant_id, patient_id, scheduled_time);
