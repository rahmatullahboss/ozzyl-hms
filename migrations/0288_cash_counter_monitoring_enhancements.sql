-- Migration 0288: Cash Counter Monitoring Enhancements
-- Adds denomination tracking, cash reconciliations, payment reminders, expense budgets

-- Step 1: Add denomination fields to billing_counter_sessions
ALTER TABLE billing_counter_sessions ADD COLUMN opening_denominations TEXT;
ALTER TABLE billing_counter_sessions ADD COLUMN closing_denominations TEXT;
ALTER TABLE billing_counter_sessions ADD COLUMN cash_drop_total REAL DEFAULT 0;

-- Step 2: Create cash_reconciliations table
CREATE TABLE IF NOT EXISTS cash_reconciliations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  reconciliation_date TEXT NOT NULL,
  counter_id INTEGER,
  expected_cash REAL NOT NULL DEFAULT 0,
  actual_cash REAL NOT NULL DEFAULT 0,
  variance REAL NOT NULL DEFAULT 0,
  notes TEXT,
  reconciled_by INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  approved_by INTEGER,
  approved_at TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX idx_cash_reconciliations_tenant ON cash_reconciliations(tenant_id, reconciliation_date);
CREATE INDEX idx_cash_reconciliations_status ON cash_reconciliations(tenant_id, status);

-- Step 3: Create payment_reminders table
CREATE TABLE IF NOT EXISTS payment_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  bill_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  due_amount REAL NOT NULL,
  reminder_method TEXT NOT NULL DEFAULT 'sms' CHECK(reminder_method IN ('sms', 'email', 'both', 'manual')),
  sent_by INTEGER,
  status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent', 'delivered', 'failed')),
  created_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX idx_payment_reminders_tenant ON payment_reminders(tenant_id, bill_id);
CREATE INDEX idx_payment_reminders_patient ON payment_reminders(tenant_id, patient_id);

-- Step 4: Create expense_budgets table
CREATE TABLE IF NOT EXISTS expense_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  category TEXT NOT NULL,
  monthly_budget REAL NOT NULL DEFAULT 0,
  year_month TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  UNIQUE(tenant_id, category, year_month)
);

CREATE INDEX idx_expense_budgets_tenant ON expense_budgets(tenant_id, year_month);
