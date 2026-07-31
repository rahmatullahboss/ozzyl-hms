-- Migration: 0238_agent_referral_commission_accounting.sql
-- Description: Add agent/referral commission GL posting support and immutable referral commission lifecycle fields.

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
    'agent_commission_accrued',
    'agent_commission_cancelled',
    'agent_commission_settled',
    'supplier_payment',
    'pharmacy_purchase',
    'pharmacy_sale_cogs',
    'inventory_purchase',
    'inventory_consumption',
    'profit_distribution_declared',
    'shareholder_dividend_paid',
    'direct_income_received',
    'direct_expense_paid',
    'cash_handover',
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

ALTER TABLE ReferralCommission ADD COLUMN Status TEXT NOT NULL DEFAULT 'accrued' CHECK(Status IN ('accrued', 'paid', 'cancelled'));
ALTER TABLE ReferralCommission ADD COLUMN PaidDate TEXT;
ALTER TABLE ReferralCommission ADD COLUMN PaidBy INTEGER;
ALTER TABLE ReferralCommission ADD COLUMN PaymentMode TEXT;
ALTER TABLE ReferralCommission ADD COLUMN PaymentReferenceNo TEXT;
ALTER TABLE ReferralCommission ADD COLUMN CancelledBy INTEGER;
ALTER TABLE ReferralCommission ADD COLUMN CancelledOn TEXT;
ALTER TABLE ReferralCommission ADD COLUMN CancellationReason TEXT;
ALTER TABLE ReferralCommission ADD COLUMN ModifiedOn TEXT;

CREATE INDEX IF NOT EXISTS idx_ref_comm_status
  ON ReferralCommission(tenant_id, Status, CreatedOn);

WITH coa_tenants AS (
  SELECT DISTINCT CAST(tenant_id AS TEXT) AS tenant_id
  FROM chart_of_accounts
),
default_accounts(code, name, type) AS (
  VALUES
    ('5860', 'Agent / Referral Commission Expense', 'expense'),
    ('8310', 'Agent / Referral Commission Payable', 'liability')
)
INSERT INTO chart_of_accounts (code, name, type, tenant_id)
SELECT a.code, a.name, a.type, ct.tenant_id
FROM coa_tenants ct
JOIN default_accounts a
WHERE NOT EXISTS (
  SELECT 1
  FROM chart_of_accounts coa
  WHERE CAST(coa.tenant_id AS TEXT) = ct.tenant_id
    AND coa.code = a.code
);

WITH coa_tenants AS (
  SELECT DISTINCT CAST(tenant_id AS TEXT) AS tenant_id
  FROM chart_of_accounts
),
mapping_defaults(mapping_key, account_code) AS (
  VALUES
    ('agent_commission_expense', '5860'),
    ('agent_commission_payable', '8310')
)
INSERT INTO accounting_account_mappings (tenant_id, mapping_key, account_id, is_active)
SELECT ct.tenant_id, md.mapping_key, coa.id, 1
FROM coa_tenants ct
JOIN mapping_defaults md
JOIN chart_of_accounts coa
  ON CAST(coa.tenant_id AS TEXT) = ct.tenant_id
 AND coa.code = md.account_code
 AND COALESCE(coa.is_active, 1) = 1
ON CONFLICT(tenant_id, mapping_key) DO UPDATE SET
  account_id = excluded.account_id,
  is_active = 1;
