-- Migration: 0369_cash_ledger_entries.sql
-- Description: Adds canonical enterprise cash ledger entries table for future write enforcement and backfill.
-- This migration is additive and non-destructive. Existing cash flows keep writing to source tables until shadow-write/backfill phases are enabled.

CREATE TABLE IF NOT EXISTS cash_ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  ledger_entry_no TEXT NOT NULL,

  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_no TEXT,
  event_type TEXT NOT NULL,

  movement_direction TEXT NOT NULL
    CHECK(movement_direction IN ('in','out','transfer','neutral')),
  cash_status TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted',

  amount REAL NOT NULL CHECK(amount >= 0),
  expected_amount REAL,
  received_amount REAL,
  due_amount REAL,
  variance_amount REAL,
  payment_method TEXT NOT NULL DEFAULT 'cash',

  from_user_id INTEGER,
  to_user_id INTEGER,
  counter_session_id INTEGER,
  counter_id INTEGER,

  current_location_type TEXT NOT NULL,
  current_location_label TEXT,

  accounting_voucher_id INTEGER,
  accounting_posting_status TEXT,

  reference_type TEXT,
  reference_id TEXT,
  note TEXT,
  metadata_json TEXT,
  idempotency_key TEXT,

  created_by INTEGER,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_ledger_entries_no
  ON cash_ledger_entries(tenant_id, ledger_entry_no);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_ledger_entries_idempotency
  ON cash_ledger_entries(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key != '';

CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_source
  ON cash_ledger_entries(tenant_id, source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_session
  ON cash_ledger_entries(tenant_id, counter_session_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_location
  ON cash_ledger_entries(tenant_id, current_location_type, cash_status, occurred_at);

CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_status
  ON cash_ledger_entries(tenant_id, status, cash_status, occurred_at);

CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_voucher
  ON cash_ledger_entries(tenant_id, accounting_voucher_id);
