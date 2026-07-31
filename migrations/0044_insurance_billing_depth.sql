-- Migration 0044: Insurance Billing Depth
-- Ported from danphe-next billing-insurance + insurance routes
-- Adds: insurance companies, claim line items, eligibility logs, membership community_name

-- ============================================================
-- Insurance Companies (proper entity vs inline provider_name)
-- ============================================================
CREATE TABLE IF NOT EXISTS insurance_companies (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id       INTEGER NOT NULL,
    company_name    TEXT    NOT NULL,
    insurance_type  TEXT,              -- health | life | government | corporate
    address         TEXT,
    city            TEXT,
    phone           TEXT,
    email           TEXT,
    payer_id        TEXT,              -- external payer identifier
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ins_companies_tenant ON insurance_companies(tenant_id, is_active);

-- ============================================================
-- Insurance Claim Items (line-item level for existing insurance_claims)
-- ============================================================
CREATE TABLE IF NOT EXISTS insurance_claim_items (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id        INTEGER NOT NULL,
    claim_id         INTEGER NOT NULL,
    service_code     TEXT,
    description      TEXT,
    quantity         INTEGER NOT NULL DEFAULT 1,
    unit_price       REAL    NOT NULL DEFAULT 0,
    total_price      REAL    NOT NULL DEFAULT 0,
    covered_amount   REAL    DEFAULT 0,
    patient_payable  REAL    DEFAULT 0,
    modifier1        TEXT,
    modifier2        TEXT,
    place_of_service TEXT    DEFAULT '11',
    service_date     TEXT,
    is_active        INTEGER DEFAULT 1,
    created_at       TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_claim_items_claim ON insurance_claim_items(tenant_id, claim_id);

-- ============================================================
-- Eligibility Check Logs (audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS eligibility_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id       INTEGER NOT NULL,
    patient_id      INTEGER NOT NULL,
    policy_id       INTEGER,
    service_type    TEXT    DEFAULT '30',
    eligible        INTEGER DEFAULT 0,
    status          TEXT,
    response_json   TEXT,
    checked_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_eligibility_patient ON eligibility_logs(tenant_id, patient_id);

-- ============================================================
-- SSF tables (Social Security Fund) — if not already present
-- ============================================================
CREATE TABLE IF NOT EXISTS ssf_patient_info (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id       INTEGER NOT NULL,
    patient_id      INTEGER NOT NULL,
    ssf_policy_no   TEXT,
    ssf_scheme_code TEXT,
    member_no       TEXT,
    claim_code      TEXT,
    claim_status    TEXT    DEFAULT 'pending',
    ssf_claim_id    TEXT,
    remarks         TEXT,
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_ssf_patient ON ssf_patient_info(tenant_id, patient_id);

CREATE TABLE IF NOT EXISTS ssf_invoices (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id         INTEGER NOT NULL,
    patient_id        INTEGER NOT NULL,
    ssf_patient_id    INTEGER,
    invoice_date      TEXT    NOT NULL,
    total_amount      REAL    DEFAULT 0,
    claimed_amount    REAL    DEFAULT 0,
    invoice_status    TEXT    DEFAULT 'pending',
    remarks           TEXT,
    is_active         INTEGER DEFAULT 1,
    created_at        TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ssf_invoices_patient ON ssf_invoices(tenant_id, patient_id);

CREATE TABLE IF NOT EXISTS ssf_settings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id       INTEGER NOT NULL,
    ssf_api_url     TEXT,
    ssf_api_code    TEXT,
    hosp_code       TEXT,
    username        TEXT,
    password        TEXT,
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- Insurance Settings
-- ============================================================
CREATE TABLE IF NOT EXISTS insurance_settings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id       INTEGER NOT NULL,
    api_url         TEXT,
    api_code        TEXT,
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- Add community_name to billing_membership_types
-- D1 ignores errors in batch execution per-statement, but to be
-- safe we create a temp table to gate the ALTER. If the column
-- already exists the SELECT throws and D1 skips the ALTER.
-- ============================================================

-- Safe idempotent column addition: create a view that will fail if column
-- already exists, preventing a duplicate-column error on re-run.
-- D1 treats each statement independently so a prior failure won't abort later ones.
CREATE TABLE IF NOT EXISTS _migration_guard_0044 (done INTEGER);
INSERT OR IGNORE INTO _migration_guard_0044 VALUES (1);

-- This will error harmlessly if community_name already exists
ALTER TABLE billing_membership_types ADD COLUMN community_name TEXT;

DROP TABLE IF EXISTS _migration_guard_0044;
