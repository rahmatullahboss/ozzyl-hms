-- Migration 0342: Two-step reception cash deposit through finance custody.

CREATE TABLE IF NOT EXISTS bank_deposit_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  request_no TEXT NOT NULL,
  counter_session_id INTEGER NOT NULL REFERENCES billing_counter_sessions(id),
  counter_id INTEGER NOT NULL REFERENCES billing_counters(id),
  requested_by INTEGER NOT NULL,
  requested_amount REAL NOT NULL CHECK(requested_amount > 0),
  proposed_bank_name TEXT,
  request_note TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','rejected','resolved')),
  idempotency_key TEXT NOT NULL,
  cash_movement_id INTEGER REFERENCES cash_drawer_movements(id),
  bank_transaction_id INTEGER REFERENCES bank_transactions(id),
  confirmed_bank_name TEXT,
  confirmed_reference_no TEXT,
  confirmed_date TEXT,
  confirmed_by INTEGER,
  confirmed_at TEXT,
  rejection_reason TEXT,
  rejected_by INTEGER,
  rejected_at TEXT,
  resolution_type TEXT
    CHECK(resolution_type IS NULL OR resolution_type IN ('deposited','returned_to_counter','manual_adjustment')),
  resolution_note TEXT,
  resolved_by INTEGER,
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT,
  UNIQUE(tenant_id, request_no),
  UNIQUE(tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_bank_deposit_requests_status
  ON bank_deposit_requests(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_bank_deposit_requests_session
  ON bank_deposit_requests(tenant_id, counter_session_id);
CREATE INDEX IF NOT EXISTS idx_bank_deposit_requests_requester
  ON bank_deposit_requests(tenant_id, requested_by, created_at);

ALTER TABLE bank_transactions ADD COLUMN bank_deposit_request_id INTEGER REFERENCES bank_deposit_requests(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_transactions_deposit_request
  ON bank_transactions(tenant_id, bank_deposit_request_id)
  WHERE bank_deposit_request_id IS NOT NULL;

PRAGMA foreign_keys = OFF;

CREATE TABLE accounting_posting_events_new (
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
    'inventory_return',
    'inventory_consumption',
    'profit_distribution_declared',
    'shareholder_dividend_paid',
    'direct_income_received',
    'direct_expense_paid',
    'cash_handover',
    'bank_deposit_custody',
    'bank_deposit_confirmed',
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
