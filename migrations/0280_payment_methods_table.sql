CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  transaction_id_required INTEGER NOT NULL DEFAULT 0,
  charge_applicable INTEGER NOT NULL DEFAULT 0,
  tenant_id TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_methods_tenant_code ON payment_methods(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_payment_methods_tenant ON payment_methods(tenant_id, active);
