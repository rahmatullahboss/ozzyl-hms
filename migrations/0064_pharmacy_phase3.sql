-- Migration: pharmacy Phase 3 additions
-- 1. MRP/Cost price history tracking
-- 2. Barcode column for pharmacy items
-- 3. Generic dosage/frequency mapping
-- 4. Approval workflow columns on GRN and write-offs

-- ─────────────────────────────────────────
-- Item price history (tracks every price change)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pharmacy_item_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    batch_no TEXT,
    old_mrp INTEGER,            -- paisa
    new_mrp INTEGER NOT NULL,   -- paisa
    old_cost_price INTEGER,
    new_cost_price INTEGER NOT NULL,
    change_reason TEXT,
    effective_date TEXT DEFAULT (date('now')),
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    tenant_id INTEGER NOT NULL,
    FOREIGN KEY (item_id) REFERENCES pharmacy_items(id)
);

CREATE INDEX IF NOT EXISTS idx_pharm_price_history_item   ON pharmacy_item_price_history(item_id);
CREATE INDEX IF NOT EXISTS idx_pharm_price_history_tenant ON pharmacy_item_price_history(tenant_id);

-- ─────────────────────────────────────────
-- Barcode column on pharmacy_items
-- ─────────────────────────────────────────
ALTER TABLE pharmacy_items ADD COLUMN barcode TEXT;

-- ─────────────────────────────────────────
-- Generic dosage/frequency mapping
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pharmacy_dosage_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    generic_id INTEGER,             -- NULL = applies to all
    dosage_label TEXT NOT NULL,     -- e.g. "1-0-1", "1/2-0-1/2"
    frequency TEXT NOT NULL,        -- e.g. "Twice Daily", "Once Daily at Night"
    route TEXT DEFAULT 'Oral',      -- Oral, IV, IM, Topical, etc.
    duration_days INTEGER,          -- suggested days; NULL = open-ended
    notes TEXT,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_pharm_dosage_generic ON pharmacy_dosage_templates(generic_id);
CREATE INDEX IF NOT EXISTS idx_pharm_dosage_tenant  ON pharmacy_dosage_templates(tenant_id);

-- ─────────────────────────────────────────
-- Approval workflow on GRNs
-- ─────────────────────────────────────────
ALTER TABLE pharmacy_grn ADD COLUMN approved_by INTEGER;
ALTER TABLE pharmacy_grn ADD COLUMN approved_at TEXT;
ALTER TABLE pharmacy_grn ADD COLUMN approval_status TEXT DEFAULT 'pending';
ALTER TABLE pharmacy_grn ADD COLUMN approval_notes TEXT;

-- Approval on write-offs
ALTER TABLE pharmacy_write_offs ADD COLUMN approved_by INTEGER;
ALTER TABLE pharmacy_write_offs ADD COLUMN approved_at TEXT;
ALTER TABLE pharmacy_write_offs ADD COLUMN approval_status TEXT DEFAULT 'pending';
ALTER TABLE pharmacy_write_offs ADD COLUMN approval_notes TEXT;
