-- Migration 0045: Fix shareholders table constraints
-- Problem: Original type CHECK only allows ('profit', 'owner').
--          Also address and phone are NOT NULL (causes crash when null).
-- Fix:    Recreate table with expanded type enum and nullable address/phone.

-- 1. Create new shareholders table with correct constraints
CREATE TABLE IF NOT EXISTS shareholders_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    share_count INTEGER NOT NULL DEFAULT 0,
    type TEXT NOT NULL CHECK(type IN ('profit', 'owner', 'investor', 'doctor', 'shareholder')),
    investment REAL NOT NULL DEFAULT 0,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- Columns from migration 0036
    email TEXT,
    nid TEXT,
    bank_name TEXT,
    bank_account_no TEXT,
    bank_branch TEXT,
    routing_no TEXT,
    share_value_bdt INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    user_id INTEGER,
    nominee_name TEXT,
    nominee_contact TEXT
);

-- 2. Copy data from old table
INSERT INTO shareholders_new (id, name, address, phone, share_count, type, investment,
    tenant_id, created_at, updated_at,
    email, nid, bank_name, bank_account_no, bank_branch, routing_no,
    share_value_bdt, is_active, user_id, nominee_name, nominee_contact)
SELECT id, name, address, phone, share_count, type, investment,
    tenant_id, created_at, updated_at,
    email, nid, bank_name, bank_account_no, bank_branch, routing_no,
    share_value_bdt, COALESCE(is_active, 1), user_id, nominee_name, nominee_contact
FROM shareholders;

-- 3. Drop old table
DROP TABLE shareholders;

-- 4. Rename new table
ALTER TABLE shareholders_new RENAME TO shareholders;

-- 5. Recreate indexes
CREATE INDEX IF NOT EXISTS idx_shareholders_type ON shareholders(type);
CREATE INDEX IF NOT EXISTS idx_shareholders_email ON shareholders(email);
CREATE INDEX IF NOT EXISTS idx_shareholders_nid ON shareholders(nid);
CREATE INDEX IF NOT EXISTS idx_shareholders_is_active ON shareholders(is_active, tenant_id);

-- 6. Also fix profit_distributions table — add missing columns from migration 0036
-- These columns may already exist, so we use IF NOT EXISTS via separate statements
-- The original table lacks: retained_amount, retained_percent, tds_applicable, tax_rate, notes, status
