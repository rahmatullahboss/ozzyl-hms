-- Migration: 0205_inventory_pharmacy_gl_expansion.sql
-- Description: Expand accounting posting events and seed real inventory/pharmacy mappings.

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
    'payment_received',
    'patient_deposit_received',
    'patient_deposit_adjusted',
    'patient_deposit_refunded',
    'commission_accrued',
    'commission_cancelled',
    'commission_settled',
    'pharmacy_purchase',
    'pharmacy_sale_cogs',
    'inventory_purchase',
    'inventory_consumption',
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

-- Add hospital-grade inventory/payable accounts per tenant. These are real
-- account defaults, not placeholder mappings.
WITH tenant_source AS (
  SELECT DISTINCT tenant_id FROM fiscal_years
  UNION
  SELECT DISTINCT tenant_id FROM chart_of_accounts
  UNION
  SELECT DISTINCT tenant_id FROM bills
),
default_accounts(code, name, type) AS (
  VALUES
    ('1300', 'Pharmacy Inventory', 'asset'),
    ('1350', 'General Inventory', 'asset'),
    ('5000', 'Medicine Cost of Goods Sold', 'expense'),
    ('5700', 'Inventory Consumption Expense', 'expense'),
    ('8000', 'Accounts Payable - Suppliers', 'liability')
)
INSERT INTO chart_of_accounts (code, name, type, tenant_id)
SELECT a.code, a.name, a.type, COALESCE((SELECT MIN(tenant_id) FROM tenant_source), 'system')
FROM default_accounts a
WHERE NOT EXISTS (
    SELECT 1
    FROM chart_of_accounts coa
    WHERE coa.code = a.code
  );

WITH tenant_source AS (
  SELECT DISTINCT tenant_id FROM fiscal_years
  UNION
  SELECT DISTINCT tenant_id FROM chart_of_accounts
  UNION
  SELECT DISTINCT tenant_id FROM bills
),
mapping_defaults(mapping_key, account_code) AS (
  VALUES
    ('pharmacy_inventory', '1300'),
    ('pharmacy_cogs', '5000'),
    ('general_inventory', '1350'),
    ('inventory_expense', '5700'),
    ('accounts_payable', '8000')
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
