-- Migration: 0194_voucher_types_and_numbering.sql
-- Description: Add voucher types, voucher numbering, and extend journal_entries with voucher fields
-- Created: 2026-05-03

-- Voucher Types
-- Stores the different types of vouchers (JV, PMTV, RCPT, CPV, CRV, etc.)
CREATE TABLE IF NOT EXISTS voucher_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  allow_verification INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, code)
);

-- Voucher Numbering
-- Tracks the last used number per voucher type per fiscal year
CREATE TABLE IF NOT EXISTS voucher_numbering (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  voucher_type_id INTEGER NOT NULL,
  fiscal_year_id INTEGER NOT NULL,
  last_number INTEGER DEFAULT 0,
  UNIQUE(tenant_id, voucher_type_id, fiscal_year_id),
  FOREIGN KEY (voucher_type_id) REFERENCES voucher_types(id)
);

-- Add voucher fields to journal_entries
ALTER TABLE journal_entries ADD COLUMN voucher_type_id INTEGER;
ALTER TABLE journal_entries ADD COLUMN voucher_number TEXT;
ALTER TABLE journal_entries ADD COLUMN status TEXT DEFAULT 'verified';
ALTER TABLE journal_entries ADD COLUMN verified_by TEXT;
ALTER TABLE journal_entries ADD COLUMN verified_at TEXT;
ALTER TABLE journal_entries ADD COLUMN rejection_reason TEXT;