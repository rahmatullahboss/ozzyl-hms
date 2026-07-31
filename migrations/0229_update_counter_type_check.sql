-- Migration 0229: Update billing_counters counter_type CHECK constraint to include 'general'
-- Must run AFTER 0213_billing_counter_sessions

-- Disable foreign keys temporarily
PRAGMA foreign_keys=OFF;

-- Step 1: Drop child tables first
DROP TABLE IF EXISTS cash_drawer_movements;
DROP TABLE IF EXISTS billing_counter_sessions;

-- Step 2: Create new table with updated CHECK constraint
CREATE TABLE IF NOT EXISTS billing_counters_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  counter_name TEXT NOT NULL,
  counter_code TEXT,
  counter_type TEXT DEFAULT 'billing' CHECK(counter_type IN ('billing','pharmacy','lab','ipd','opd','emergency','general','other')),
  location TEXT,
  description TEXT,
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Step 3: Copy data from old table
INSERT INTO billing_counters_new (id, counter_name, counter_code, counter_type, location, description, is_active, tenant_id, created_at)
SELECT id, counter_name, counter_code, counter_type, location, description, is_active, tenant_id, created_at FROM billing_counters;

-- Step 4: Drop old table
DROP TABLE billing_counters;

-- Step 5: Rename new table
ALTER TABLE billing_counters_new RENAME TO billing_counters;

-- Step 6: Recreate indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_counters_code
  ON billing_counters(tenant_id, counter_code)
  WHERE counter_code IS NOT NULL AND is_active = 1;

-- Step 7: Recreate child tables with updated CHECK constraint
CREATE TABLE IF NOT EXISTS billing_counter_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  counter_id INTEGER NOT NULL REFERENCES billing_counters(id),
  employee_id INTEGER NOT NULL,
  session_no TEXT NOT NULL,
  counter_type TEXT NOT NULL DEFAULT 'billing'
    CHECK(counter_type IN ('billing','pharmacy','lab','ipd','opd','emergency','general','other')),
  opening_cash REAL NOT NULL DEFAULT 0 CHECK(opening_cash >= 0),
  closing_cash_declared REAL,
  expected_cash REAL,
  variance REAL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed','void')),
  opened_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  closed_at TEXT,
  remarks TEXT,
  closed_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_counter_sessions_session_no
  ON billing_counter_sessions(tenant_id, session_no);
CREATE UNIQUE INDEX IF NOT EXISTS idx_counter_sessions_one_active_employee
  ON billing_counter_sessions(tenant_id, employee_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_counter_sessions_counter
  ON billing_counter_sessions(tenant_id, counter_id, status);

CREATE TABLE IF NOT EXISTS cash_drawer_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  counter_session_id INTEGER NOT NULL REFERENCES billing_counter_sessions(id),
  counter_id INTEGER NOT NULL REFERENCES billing_counters(id),
  employee_id INTEGER NOT NULL,
  movement_type TEXT NOT NULL CHECK(movement_type IN ('opening','cash_in','cash_out','handover','closing_adjustment')),
  amount REAL NOT NULL CHECK(amount >= 0),
  payment_method TEXT DEFAULT 'cash',
  reference_type TEXT,
  reference_id TEXT,
  description TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX IF NOT EXISTS idx_cash_drawer_session
  ON cash_drawer_movements(tenant_id, counter_session_id, created_at);

-- Re-enable foreign keys
PRAGMA foreign_keys=ON;
