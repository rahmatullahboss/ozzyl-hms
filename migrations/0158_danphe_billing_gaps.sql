-- Migration 0158: Fill DanpheEMR billing gaps
-- Fiscal Years, EmpCashTransaction, Price Categories, Pharmacy Returns

-- ============================================================
-- 1. FISCAL YEARS
-- ============================================================
CREATE TABLE IF NOT EXISTS fiscal_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  fiscal_year_name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  prefix TEXT DEFAULT 'BL',
  insurance_prefix TEXT DEFAULT 'INS',
  pharmacy_prefix TEXT DEFAULT 'PHR',
  is_active INTEGER DEFAULT 1,
  is_closed INTEGER DEFAULT 0,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_fiscal_years_tenant ON fiscal_years(tenant_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fiscal_years_tenant_name ON fiscal_years(tenant_id, fiscal_year_name);

-- ============================================================
-- 2. EMP CASH TRANSACTIONS (per-employee cash audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS emp_cash_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  employee_id INTEGER NOT NULL,
  counter_id INTEGER,
  transaction_type TEXT NOT NULL CHECK(transaction_type IN (
    'CashSales', 'SalesReturn', 'DepositDeduct', 'ReturnDeposit',
    'CollectionFromReceivable', 'CashDiscountGiven', 'CashDiscountReceived'
  )),
  amount REAL NOT NULL,
  reference_id INTEGER,
  reference_type TEXT,
  payment_method TEXT,
  description TEXT,
  transaction_date TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_emp_cash_tenant_employee ON emp_cash_transactions(tenant_id, employee_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_emp_cash_tenant_type ON emp_cash_transactions(tenant_id, transaction_type, transaction_date);
CREATE INDEX IF NOT EXISTS idx_emp_cash_reference ON emp_cash_transactions(reference_type, reference_id);

-- ============================================================
-- 3. PRICE CATEGORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS price_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  category_name TEXT NOT NULL,
  category_code TEXT,
  description TEXT,
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_price_categories_tenant ON price_categories(tenant_id, is_active);

-- Seed default price category for existing tenants
INSERT INTO price_categories (tenant_id, category_name, category_code, description, is_default, is_active)
SELECT DISTINCT tenant_id, 'Normal', 'NOR', 'Standard price', 1, 1 FROM billing_service_items
WHERE NOT EXISTS (SELECT 1 FROM price_categories);

-- ============================================================
-- 4. BILLING ITEM PRICE CATEGORY MAPS
-- ============================================================
CREATE TABLE IF NOT EXISTS billing_item_price_category_maps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  service_item_id INTEGER NOT NULL,
  price_category_id INTEGER NOT NULL,
  price REAL NOT NULL,
  is_discount_applicable INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT,
  FOREIGN KEY (service_item_id) REFERENCES billing_service_items(id),
  FOREIGN KEY (price_category_id) REFERENCES price_categories(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_price_map_item_category ON billing_item_price_category_maps(tenant_id, service_item_id, price_category_id);
CREATE INDEX IF NOT EXISTS idx_price_map_tenant ON billing_item_price_category_maps(tenant_id, is_active);

-- Seed existing prices into the default category
INSERT INTO billing_item_price_category_maps (tenant_id, service_item_id, price_category_id, price, is_active)
SELECT bsi.tenant_id, bsi.id, pc.id, bsi.price, 1
FROM billing_service_items bsi
JOIN price_categories pc ON pc.tenant_id = bsi.tenant_id AND pc.is_default = 1
WHERE NOT EXISTS (
  SELECT 1 FROM billing_item_price_category_maps m
  WHERE m.tenant_id = bsi.tenant_id AND m.service_item_id = bsi.id
);

-- ============================================================
-- 5. PHARMACY RETURNS
-- ============================================================
CREATE TABLE IF NOT EXISTS pharmacy_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  return_no TEXT NOT NULL,
  sale_invoice_id INTEGER NOT NULL,
  patient_id INTEGER,
  total_return_amount REAL NOT NULL DEFAULT 0,
  payment_method TEXT DEFAULT 'cash',
  remarks TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_returns_tenant ON pharmacy_returns(tenant_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacy_returns_no ON pharmacy_returns(tenant_id, return_no);

CREATE TABLE IF NOT EXISTS pharmacy_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL,
  sale_item_id INTEGER NOT NULL,
  medicine_id INTEGER NOT NULL,
  returned_qty INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL,
  batch_no TEXT,
  expiry_date TEXT,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (return_id) REFERENCES pharmacy_returns(id)
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_return_items_return ON pharmacy_return_items(return_id);

-- ============================================================
-- 6. ALTER EXISTING TABLES
-- ============================================================

-- Bills: add fiscal year, invoice code, print count, created_by
ALTER TABLE bills ADD COLUMN fiscal_year_id INTEGER;
ALTER TABLE bills ADD COLUMN invoice_code TEXT DEFAULT 'BL';
ALTER TABLE bills ADD COLUMN print_count INTEGER DEFAULT 0;
ALTER TABLE bills ADD COLUMN is_insurance_billing INTEGER DEFAULT 0;
ALTER TABLE bills ADD COLUMN co_payment_amount INTEGER DEFAULT 0;

-- Invoice items: add co-payment fields, insurance flag
ALTER TABLE invoice_items ADD COLUMN co_payment_cash_amount INTEGER DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN co_payment_credit_amount INTEGER DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN is_insurance INTEGER DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN discount_scheme_id INTEGER;

-- Pharmacy sales: add print count
ALTER TABLE pharmacy_sales ADD COLUMN print_count INTEGER DEFAULT 0;

-- Pharmacy purchases: add verifier
ALTER TABLE pharmacy_purchases ADD COLUMN verified_by INTEGER;
ALTER TABLE pharmacy_purchases ADD COLUMN verified_at TEXT;

-- Deposits: add print count
ALTER TABLE billing_deposits ADD COLUMN print_count INTEGER DEFAULT 0;

-- Credit notes: add print count
ALTER TABLE credit_notes ADD COLUMN print_count INTEGER DEFAULT 0;

-- Settlements: add print count
ALTER TABLE bill_settlements ADD COLUMN print_count INTEGER DEFAULT 0;

-- Patients: add duplicate detection fields
ALTER TABLE patients ADD COLUMN is_duplicate INTEGER DEFAULT 0;
ALTER TABLE patients ADD COLUMN duplicate_of_patient_id INTEGER;
ALTER TABLE patients ADD COLUMN verified_mobile INTEGER DEFAULT 0;

-- ============================================================
-- 7. INDEXES FOR PERFORMANCE
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_bills_fiscal_year ON bills(tenant_id, fiscal_year_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bills_invoice_code ON bills(tenant_id, invoice_code, invoice_no);
CREATE INDEX IF NOT EXISTS idx_emp_cash_date ON emp_cash_transactions(tenant_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_price_maps_active ON billing_item_price_category_maps(tenant_id, price_category_id, is_active);

-- ============================================================
-- 8. FISCAL YEAR SEQUENCE COUNTERS
-- ============================================================
-- We use a separate counter table for fiscal-year-scoped numbering
CREATE TABLE IF NOT EXISTS fiscal_year_sequences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  fiscal_year_id INTEGER NOT NULL,
  sequence_type TEXT NOT NULL,
  current_value INTEGER DEFAULT 0,
  UNIQUE(tenant_id, fiscal_year_id, sequence_type)
);
