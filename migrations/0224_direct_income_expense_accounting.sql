-- Migration: 0224_direct_income_expense_accounting.sql
-- Description: Allow direct income/expense accounting events and add a general expense mapping.
-- Safe to run on existing data. It only expands the event-type constraint and seeds missing COA/mapping rows.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS accounting_posting_events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  source_event_key TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'bill_created',
    'bill_cancelled',
    'credit_note_issued',
    'payment_received',
    'patient_deposit_received',
    'patient_deposit_adjusted',
    'patient_deposit_refunded',
    'settlement_discount',
    'commission_accrued',
    'commission_cancelled',
    'commission_settled',
    'supplier_payment',
    'pharmacy_purchase',
    'pharmacy_sale_cogs',
    'inventory_purchase',
    'inventory_consumption',
    'profit_distribution_declared',
    'shareholder_dividend_paid',
    'direct_income_received',
    'direct_expense_paid',
    'manual_journal'
  )),
  event_date TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'posted', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  posted_voucher_id INTEGER,
  posted_at TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT,
  UNIQUE(tenant_id, source_event_key),
  FOREIGN KEY (posted_voucher_id) REFERENCES accounting_vouchers(id)
);

INSERT OR IGNORE INTO accounting_posting_events_new (
  id, tenant_id, source_event_key, source_type, source_id, event_type, event_date,
  payload_json, status, attempts, last_error, posted_voucher_id, posted_at,
  created_by, created_at, updated_at
)
SELECT
  id, tenant_id, source_event_key, source_type, source_id, event_type, event_date,
  payload_json, status, attempts, last_error, posted_voucher_id, posted_at,
  created_by, created_at, updated_at
FROM accounting_posting_events;

DROP TABLE accounting_posting_events;
ALTER TABLE accounting_posting_events_new RENAME TO accounting_posting_events;

CREATE INDEX IF NOT EXISTS idx_accounting_posting_events_status
  ON accounting_posting_events(status, created_at);
CREATE INDEX IF NOT EXISTS idx_accounting_posting_events_source
  ON accounting_posting_events(tenant_id, source_type, source_id, event_type);

PRAGMA foreign_keys = ON;

WITH tenant_source AS (
  SELECT DISTINCT tenant_id FROM fiscal_years
  UNION
  SELECT DISTINCT tenant_id FROM chart_of_accounts
  UNION
  SELECT DISTINCT tenant_id FROM income
  UNION
  SELECT DISTINCT tenant_id FROM expenses
),
default_accounts(code, name, type) AS (
  VALUES
    ('5990', 'General Operating Expense', 'expense')
)
INSERT INTO chart_of_accounts (code, name, type, tenant_id)
SELECT
  a.code,
  a.name,
  a.type,
  COALESCE((SELECT tenant_id FROM chart_of_accounts LIMIT 1), (SELECT MIN(tenant_id) FROM tenant_source))
FROM default_accounts a
WHERE (SELECT COUNT(*) FROM tenant_source WHERE tenant_id IS NOT NULL) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM chart_of_accounts coa
    WHERE coa.code = a.code
  );

WITH tenant_source AS (
  SELECT DISTINCT tenant_id FROM fiscal_years
  UNION
  SELECT DISTINCT tenant_id FROM chart_of_accounts
  UNION
  SELECT DISTINCT tenant_id FROM income
  UNION
  SELECT DISTINCT tenant_id FROM expenses
),
mapping_defaults(mapping_key, account_code) AS (
  VALUES
    ('general_expense', '5990')
)
INSERT INTO accounting_account_mappings (tenant_id, mapping_key, account_id, is_active)
SELECT ts.tenant_id, md.mapping_key, coa.id, 1
FROM tenant_source ts
JOIN mapping_defaults md
JOIN chart_of_accounts coa
  ON coa.code = md.account_code
  AND coa.is_active = 1
WHERE ts.tenant_id IS NOT NULL
ON CONFLICT(tenant_id, mapping_key) DO UPDATE SET
  account_id = excluded.account_id,
  is_active = 1;
