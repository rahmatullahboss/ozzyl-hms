-- Migration: pharmacy_tax_config table
-- Tax rate configurations per tenant (VAT, GST, etc.)

CREATE TABLE IF NOT EXISTS pharmacy_tax_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tax_name TEXT NOT NULL,                   -- e.g. 'VAT', 'GST', 'Surcharge'
    tax_rate REAL NOT NULL DEFAULT 0,         -- percentage (e.g. 15.0 for 15%)
    tax_type TEXT NOT NULL DEFAULT 'percentage',  -- 'percentage' | 'flat'
    is_active INTEGER NOT NULL DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_pharm_tax_config_tenant ON pharmacy_tax_config(tenant_id);

-- Add item_type and is_narcotic columns to pharmacy_items
-- (D1 does not support ADD COLUMN IF NOT EXISTS — safe since these are new fields)
ALTER TABLE pharmacy_items ADD COLUMN item_type TEXT DEFAULT 'general';
ALTER TABLE pharmacy_items ADD COLUMN is_narcotic INTEGER DEFAULT 0;
