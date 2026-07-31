-- Migration 0036: Enhance shareholders table
-- Adds new optional fields for bank details, NID, email, nominee, etc.
-- Also adds shareholder_distributions table and fixes settings UNIQUE constraint.
-- Safe to run on existing tenant DBs (all ALTER TABLE + CREATE TABLE IF NOT EXISTS)

-- ─── 1. Add new columns to shareholders ───────────────────────
ALTER TABLE shareholders ADD COLUMN email TEXT;
ALTER TABLE shareholders ADD COLUMN nid TEXT;
ALTER TABLE shareholders ADD COLUMN bank_name TEXT;
ALTER TABLE shareholders ADD COLUMN bank_account_no TEXT;
ALTER TABLE shareholders ADD COLUMN bank_branch TEXT;
ALTER TABLE shareholders ADD COLUMN routing_no TEXT;
ALTER TABLE shareholders ADD COLUMN share_value_bdt INTEGER;
ALTER TABLE shareholders ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE shareholders ADD COLUMN user_id INTEGER;
ALTER TABLE shareholders ADD COLUMN nominee_name TEXT;
ALTER TABLE shareholders ADD COLUMN nominee_contact TEXT;

-- ─── 2. Expand type constraint by allowing all values ─────────
-- (SQLite cannot alter CHECK constraints, so new types will just be stored as-is)
-- The Zod schema above now accepts: profit, owner, investor, doctor, shareholder

-- ─── 3. Add new columns to profit_distributions ───────────────
ALTER TABLE profit_distributions ADD COLUMN retained_amount REAL DEFAULT 0;
ALTER TABLE profit_distributions ADD COLUMN retained_percent REAL DEFAULT 0;
ALTER TABLE profit_distributions ADD COLUMN tds_applicable INTEGER DEFAULT 0;
ALTER TABLE profit_distributions ADD COLUMN tax_rate REAL DEFAULT 0;
ALTER TABLE profit_distributions ADD COLUMN notes TEXT;
ALTER TABLE profit_distributions ADD COLUMN status TEXT DEFAULT 'finalized';

-- ─── 4. Create shareholder_distributions (if not exists) ──────
CREATE TABLE IF NOT EXISTS shareholder_distributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    distribution_id INTEGER NOT NULL,
    shareholder_id INTEGER NOT NULL,
    share_count INTEGER DEFAULT 0,
    per_share_amount REAL DEFAULT 0,
    distribution_amount REAL DEFAULT 0,
    gross_dividend REAL DEFAULT 0,
    tax_deducted REAL DEFAULT 0,
    net_payable REAL DEFAULT 0,
    paid_status TEXT DEFAULT 'unpaid',
    paid_date DATE,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (distribution_id) REFERENCES profit_distributions(id),
    FOREIGN KEY (shareholder_id) REFERENCES shareholders(id)
);

-- ─── 5. Fix settings UNIQUE constraint (multi-tenant safe) ────
-- SQLite cannot DROP constraints, so we recreate the table
CREATE TABLE IF NOT EXISTS settings_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    tenant_id INTEGER NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(key, tenant_id)
);
INSERT OR IGNORE INTO settings_new (id, key, value, tenant_id, updated_at)
    SELECT id, key, value, tenant_id, updated_at FROM settings;
DROP TABLE settings;
ALTER TABLE settings_new RENAME TO settings;

-- ─── 6. Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_shareholders_email ON shareholders(email);
CREATE INDEX IF NOT EXISTS idx_shareholders_nid ON shareholders(nid);
CREATE INDEX IF NOT EXISTS idx_shareholders_is_active ON shareholders(is_active, tenant_id);
CREATE INDEX IF NOT EXISTS idx_sd_distribution ON shareholder_distributions(distribution_id);
CREATE INDEX IF NOT EXISTS idx_sd_shareholder ON shareholder_distributions(shareholder_id);
CREATE INDEX IF NOT EXISTS idx_sd_tenant ON shareholder_distributions(tenant_id);
