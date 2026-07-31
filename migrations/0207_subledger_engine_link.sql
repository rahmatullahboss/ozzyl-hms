-- Migration: 0207_subledger_engine_link.sql
-- Description: Link sub_ledger_transactions to the new accounting engine.

-- We check if it exists in maintenance.ts, but here we try adding it.
-- SQLite doesn't support IF NOT EXISTS in ALTER TABLE.
ALTER TABLE sub_ledger_transactions ADD COLUMN voucher_id INTEGER REFERENCES accounting_vouchers(id);
