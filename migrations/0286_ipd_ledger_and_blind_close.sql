-- IPD Patient Ledger: unified double-entry ledger for admission-wise billing
CREATE TABLE IF NOT EXISTS ipd_ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  admission_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('charge', 'payment', 'discount', 'refund', 'adjustment', 'reversal', 'deposit_deduction', 'deposit_refund')),
  category TEXT,
  description TEXT NOT NULL,
  debit_amount REAL NOT NULL DEFAULT 0,
  credit_amount REAL NOT NULL DEFAULT 0,
  payment_id INTEGER,
  bill_id INTEGER,
  deposit_id INTEGER,
  credit_note_id INTEGER,
  counter_session_id INTEGER,
  created_by INTEGER,
  approved_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  remarks TEXT
);
CREATE INDEX IF NOT EXISTS idx_ipd_ledger_admission ON ipd_ledger_entries(tenant_id, admission_id);
CREATE INDEX IF NOT EXISTS idx_ipd_ledger_patient ON ipd_ledger_entries(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_ipd_ledger_type ON ipd_ledger_entries(tenant_id, entry_type);
CREATE INDEX IF NOT EXISTS idx_ipd_ledger_created ON ipd_ledger_entries(tenant_id, created_at);

-- Blind cash close setting on billing_counters
ALTER TABLE billing_counters ADD COLUMN cash_visibility_mode TEXT DEFAULT 'show_all';
