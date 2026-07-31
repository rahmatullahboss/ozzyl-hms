-- Migration: 0360_reception_cash_custody_transfers.sql
-- Description: Adds controlled mid-shift cash custody transfers from reception drawers to finance/admin/MD custody.

CREATE TABLE IF NOT EXISTS billing_counter_cash_transfers (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id          TEXT NOT NULL,
  counter_session_id INTEGER NOT NULL REFERENCES billing_counter_sessions(id),
  counter_id         INTEGER NOT NULL REFERENCES billing_counters(id),
  transfer_no        TEXT NOT NULL,
  transfer_by        INTEGER NOT NULL,
  transfer_to        INTEGER NOT NULL,
  amount             REAL NOT NULL CHECK(amount > 0),
  received_amount    REAL NOT NULL DEFAULT 0 CHECK(received_amount >= 0),
  due_amount         REAL NOT NULL DEFAULT 0 CHECK(due_amount >= 0),
  status             TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','received','partial','disputed','cancelled')),
  note               TEXT,
  receiver_note      TEXT,
  received_by        INTEGER,
  received_at        DATETIME,
  accounting_voucher_id INTEGER REFERENCES accounting_vouchers(id),
  idempotency_key    TEXT,
  created_by         INTEGER,
  created_at         DATETIME DEFAULT (datetime('now', '+6 hours')),
  updated_at         DATETIME DEFAULT (datetime('now', '+6 hours'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_counter_cash_transfers_no
  ON billing_counter_cash_transfers(tenant_id, transfer_no);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_counter_cash_transfers_idempotency
  ON billing_counter_cash_transfers(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key != '';

CREATE INDEX IF NOT EXISTS idx_billing_counter_cash_transfers_session
  ON billing_counter_cash_transfers(tenant_id, counter_session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_billing_counter_cash_transfers_recipient
  ON billing_counter_cash_transfers(tenant_id, transfer_to, status, created_at);
