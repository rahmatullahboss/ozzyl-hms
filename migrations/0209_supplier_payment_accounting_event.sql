-- Migration: 0209_supplier_payment_accounting_event.sql
-- Description: Adds supplier/vendor payments and credit notes to the centralized accounting posting event contract.

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
