-- Cost Centers
CREATE TABLE IF NOT EXISTS cost_centers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, code)
);

-- SubLedgers (maps to accounts receivable/payable categories)
CREATE TABLE IF NOT EXISTS sub_ledgers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'consultant', 'vendor', 'customer', 'employee', 'other'
  contact_info TEXT,   -- phone, email, address
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, code, type)
);

-- Link journal entries to cost centers
ALTER TABLE journal_entries ADD COLUMN cost_center_id INTEGER;

-- SubLedger transactions (records which sub-ledger was used in each transaction)
CREATE TABLE IF NOT EXISTS sub_ledger_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  sub_ledger_id INTEGER NOT NULL,
  journal_entry_id INTEGER NOT NULL,
  dr_amount REAL DEFAULT 0,
  cr_amount REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (sub_ledger_id) REFERENCES sub_ledgers(id)
);

-- Seed default cost centers
INSERT OR IGNORE INTO cost_centers (tenant_id, code, name, description) VALUES
  ('demo-hospital', 'HOSP', 'Hospital', 'Main hospital operations'),
  ('demo-hospital', 'OP', 'Outpatient', 'Outpatient department'),
  ('demo-hospital', 'IP', 'Inpatient', 'Inpatient ward'),
  ('demo-hospital', 'LAB', 'Laboratory', 'Lab services'),
  ('demo-hospital', 'PHARM', 'Pharmacy', 'Pharmacy services'),
  ('demo-hospital', 'RAD', 'Radiology', 'Imaging services'),
  ('demo-hospital', 'OT', 'Operation Theatre', 'Surgery department'),
  ('demo-hospital', 'EMG', 'Emergency', 'Emergency department');

-- Seed default sub-ledgers
INSERT OR IGNORE INTO sub_ledgers (tenant_id, code, name, type, contact_info) VALUES
  ('demo-hospital', 'EMP', 'Employee Advances', 'employee', '{"phone": ""}'),
  ('demo-hospital', 'CON', 'Consultant Payments', 'consultant', '{"phone": ""}'),
  ('demo-hospital', 'VEN', 'Vendor Payables', 'vendor', '{"phone": ""}'),
  ('demo-hospital', 'PAT', 'Patient Deposits', 'customer', '{"phone": ""}');