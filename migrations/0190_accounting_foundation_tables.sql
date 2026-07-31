-- Migration: 0190_accounting_foundation_tables.sql
-- Description: Create the base COA and legacy journal tables required by the later accounting migrations.

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity')),
  parent_id INTEGER,
  is_active INTEGER DEFAULT 1,
  tenant_id TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, code),
  FOREIGN KEY (parent_id) REFERENCES chart_of_accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_type
  ON chart_of_accounts(tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_code
  ON chart_of_accounts(tenant_id, code);

CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date TEXT NOT NULL,
  reference TEXT,
  description TEXT,
  debit_account_id INTEGER NOT NULL,
  credit_account_id INTEGER NOT NULL,
  amount REAL NOT NULL CHECK(amount > 0),
  created_by INTEGER,
  tenant_id TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  is_deleted INTEGER DEFAULT 0,
  FOREIGN KEY (debit_account_id) REFERENCES chart_of_accounts(id),
  FOREIGN KEY (credit_account_id) REFERENCES chart_of_accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_date
  ON journal_entries(tenant_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_accounts
  ON journal_entries(tenant_id, debit_account_id, credit_account_id);
