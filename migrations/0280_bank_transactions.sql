CREATE TABLE IF NOT EXISTS bank_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('deposit','card_settlement','supplier_payment','other')),
  amount REAL NOT NULL DEFAULT 0,
  bank_name TEXT,
  reference_no TEXT,
  description TEXT,
  date TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant_date
  ON bank_transactions(tenant_id, date);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant_type_date
  ON bank_transactions(tenant_id, type, date);
