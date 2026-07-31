-- =============================================================================
-- HMS Migration 0001: Fix schema + add all missing tables
-- Applied: 2026-03-11
-- =============================================================================

-- NOTE: D1 (SQLite) does not support ALTER COLUMN for type changes.
-- Existing money fields that are REAL stay as-is in old tables;
-- all NEW tables use INTEGER (paisa/poysha) for money.
-- The old tables (bills, payments, income, expenses, etc.) should be
-- migrated incrementally in a separate data-migration step.

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DOCTORS MASTER
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctors (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  specialty         TEXT,
  mobile_number     TEXT,
  consultation_fee  INTEGER NOT NULL DEFAULT 0,  -- stored in paisa (1 BDT = 100 paisa)
  is_active         INTEGER NOT NULL DEFAULT 1,
  tenant_id         INTEGER NOT NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_doctors_tenant    ON doctors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_doctors_is_active ON doctors(is_active);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. LAB TEST CATALOG (master list of all available lab tests)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_test_catalog (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  category    TEXT,                   -- 'blood','urine','xray','ultrasound','ecg','other'
  price       INTEGER NOT NULL DEFAULT 0,  -- paisa
  is_active   INTEGER NOT NULL DEFAULT 1,
  tenant_id   INTEGER NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_test_catalog_tenant    ON lab_test_catalog(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lab_test_catalog_is_active ON lab_test_catalog(is_active);
CREATE INDEX IF NOT EXISTS idx_lab_test_catalog_code      ON lab_test_catalog(code);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. VISITS (OPD / IPD)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id      INTEGER NOT NULL,
  visit_no        TEXT,                       -- e.g. V-000001
  doctor_id       INTEGER,
  visit_type      TEXT NOT NULL DEFAULT 'opd' CHECK(visit_type IN ('opd', 'ipd')),
  admission_flag  INTEGER NOT NULL DEFAULT 0,
  admission_no    TEXT,
  admission_date  DATETIME,
  discharge_date  DATETIME,
  notes           TEXT,
  tenant_id       INTEGER NOT NULL,
  created_by      INTEGER,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (doctor_id)  REFERENCES doctors(id)
);

CREATE INDEX IF NOT EXISTS idx_visits_patient   ON visits(patient_id);
CREATE INDEX IF NOT EXISTS idx_visits_doctor    ON visits(doctor_id);
CREATE INDEX IF NOT EXISTS idx_visits_tenant    ON visits(tenant_id);
CREATE INDEX IF NOT EXISTS idx_visits_type      ON visits(visit_type);
CREATE INDEX IF NOT EXISTS idx_visits_date      ON visits(created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. LAB ORDERS (links a patient/visit to one or more tests from the catalog)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no        TEXT,             -- e.g. LO-000001
  patient_id      INTEGER NOT NULL,
  visit_id        INTEGER,
  ordered_by      INTEGER,          -- user_id who ordered
  order_date      DATE    NOT NULL,
  print_count     INTEGER NOT NULL DEFAULT 0,
  last_printed_at DATETIME,
  tenant_id       INTEGER NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (visit_id)   REFERENCES visits(id)
);

CREATE INDEX IF NOT EXISTS idx_lab_orders_patient ON lab_orders(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_orders_date    ON lab_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_lab_orders_tenant  ON lab_orders(tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. LAB ORDER ITEMS (individual test within an order)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_order_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_order_id     INTEGER NOT NULL,
  lab_test_id      INTEGER NOT NULL,
  unit_price       INTEGER NOT NULL DEFAULT 0,  -- paisa (copied at time of order)
  discount         INTEGER NOT NULL DEFAULT 0,  -- paisa
  line_total       INTEGER NOT NULL DEFAULT 0,  -- paisa
  result           TEXT,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed')),
  completed_at     DATETIME,
  tenant_id        INTEGER NOT NULL,
  FOREIGN KEY (lab_order_id) REFERENCES lab_orders(id),
  FOREIGN KEY (lab_test_id)  REFERENCES lab_test_catalog(id)
);

CREATE INDEX IF NOT EXISTS idx_lab_order_items_order  ON lab_order_items(lab_order_id);
CREATE INDEX IF NOT EXISTS idx_lab_order_items_test   ON lab_order_items(lab_test_id);
CREATE INDEX IF NOT EXISTS idx_lab_order_items_status ON lab_order_items(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. SUPPLIERS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  mobile_number  TEXT,
  address        TEXT,
  notes          TEXT,
  tenant_id      INTEGER NOT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers(tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. MEDICINE PURCHASES (from supplier)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medicine_purchases (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_no     TEXT,             -- e.g. PUR-000001
  supplier_id     INTEGER,
  purchase_date   DATE    NOT NULL,
  subtotal        INTEGER NOT NULL DEFAULT 0,  -- paisa
  discount_total  INTEGER NOT NULL DEFAULT 0,  -- paisa
  total_amount    INTEGER NOT NULL DEFAULT 0,  -- paisa
  paid_amount     INTEGER NOT NULL DEFAULT 0,  -- paisa
  due_amount      INTEGER NOT NULL DEFAULT 0,  -- paisa
  tenant_id       INTEGER NOT NULL,
  created_by      INTEGER,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE INDEX IF NOT EXISTS idx_medicine_purchases_tenant   ON medicine_purchases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_medicine_purchases_supplier ON medicine_purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_medicine_purchases_date     ON medicine_purchases(purchase_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. MEDICINE PURCHASE ITEMS (line items of a purchase)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medicine_purchase_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id     INTEGER NOT NULL,
  medicine_id     INTEGER NOT NULL,
  batch_no        TEXT,
  expiry_date     DATE,
  quantity        INTEGER NOT NULL,
  purchase_price  INTEGER NOT NULL,  -- paisa per unit
  sale_price      INTEGER NOT NULL,  -- paisa per unit
  line_total      INTEGER NOT NULL,  -- paisa (quantity * purchase_price)
  tenant_id       INTEGER NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES medicine_purchases(id),
  FOREIGN KEY (medicine_id) REFERENCES medicines(id)
);

CREATE INDEX IF NOT EXISTS idx_medicine_purchase_items_purchase ON medicine_purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_medicine_purchase_items_medicine ON medicine_purchase_items(medicine_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. MEDICINE STOCK BATCHES (batch-level stock tracking)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medicine_stock_batches (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  medicine_id         INTEGER NOT NULL,
  batch_no            TEXT,
  expiry_date         DATE,
  quantity_received   INTEGER NOT NULL,
  quantity_available  INTEGER NOT NULL,
  purchase_price      INTEGER NOT NULL DEFAULT 0,  -- paisa
  sale_price          INTEGER NOT NULL DEFAULT 0,  -- paisa
  purchase_item_id    INTEGER,
  tenant_id           INTEGER NOT NULL,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medicine_id)      REFERENCES medicines(id),
  FOREIGN KEY (purchase_item_id) REFERENCES medicine_purchase_items(id)
);

CREATE INDEX IF NOT EXISTS idx_medicine_stock_batches_medicine ON medicine_stock_batches(medicine_id);
CREATE INDEX IF NOT EXISTS idx_medicine_stock_batches_expiry   ON medicine_stock_batches(expiry_date);
CREATE INDEX IF NOT EXISTS idx_medicine_stock_batches_tenant   ON medicine_stock_batches(tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. MEDICINE STOCK MOVEMENTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medicine_stock_movements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  medicine_id    INTEGER NOT NULL,
  batch_id       INTEGER,
  movement_type  TEXT NOT NULL CHECK(movement_type IN ('purchase_in','sale_out','adjustment','return','expired')),
  quantity       INTEGER NOT NULL,
  unit_cost      INTEGER,   -- paisa
  unit_price     INTEGER,   -- paisa
  reference_type TEXT,      -- 'purchase' | 'sale' | 'manual'
  reference_id   INTEGER,
  movement_date  DATE    NOT NULL,
  tenant_id      INTEGER NOT NULL,
  created_by     INTEGER,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medicine_id) REFERENCES medicines(id),
  FOREIGN KEY (batch_id)    REFERENCES medicine_stock_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_medicine ON medicine_stock_movements(medicine_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_date     ON medicine_stock_movements(movement_date);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type     ON medicine_stock_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant   ON medicine_stock_movements(tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. INVOICE ITEMS (itemized line items per bill)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id        INTEGER NOT NULL,
  item_category  TEXT    NOT NULL CHECK(item_category IN ('test','doctor_visit','operation','medicine','admission','other')),
  description    TEXT,
  quantity       INTEGER NOT NULL DEFAULT 1,
  unit_price     INTEGER NOT NULL,   -- paisa
  line_total     INTEGER NOT NULL,   -- paisa (quantity * unit_price)
  reference_id   INTEGER,            -- FK to lab_order_id, visit_id, etc.
  tenant_id      INTEGER NOT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (bill_id) REFERENCES bills(id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_bill   ON invoice_items(bill_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_cat    ON invoice_items(item_category);
CREATE INDEX IF NOT EXISTS idx_invoice_items_tenant ON invoice_items(tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. SETTLEMENT TYPES (configurable: current, due, fire_service, …)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settlement_types (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  tenant_id  INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_types_code_tenant ON settlement_types(code, tenant_id);

-- Seed global settlement types (tenant_id = 0 means "system default")
INSERT OR IGNORE INTO settlement_types (code, name, is_active, tenant_id)
VALUES
  ('current',      'Current Payment',      1, 0),
  ('due',          'Due Payment',          1, 0),
  ('fire_service', 'Fire Service',         1, 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. SEQUENCE COUNTERS (for invoice_no, receipt_no, patient_code, etc.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sequence_counters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  counter_type  TEXT    NOT NULL,   -- 'patient','invoice','receipt','lab_order','visit','purchase'
  prefix        TEXT    NOT NULL DEFAULT '',
  current_value INTEGER NOT NULL DEFAULT 0,
  tenant_id     INTEGER NOT NULL,
  UNIQUE(counter_type, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_sequence_counters_type ON sequence_counters(counter_type, tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. SHAREHOLDER DISTRIBUTIONS PER PERSON
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shareholder_distributions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  distribution_id     INTEGER NOT NULL,        -- FK to profit_distributions
  shareholder_id      INTEGER NOT NULL,
  share_count         INTEGER NOT NULL,
  per_share_amount    INTEGER NOT NULL,         -- paisa
  distribution_amount INTEGER NOT NULL,         -- paisa (share_count * per_share_amount)
  paid_status         TEXT NOT NULL DEFAULT 'unpaid' CHECK(paid_status IN ('unpaid','paid')),
  paid_date           DATE,
  notes               TEXT,
  tenant_id           INTEGER NOT NULL,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (distribution_id) REFERENCES profit_distributions(id),
  FOREIGN KEY (shareholder_id)  REFERENCES shareholders(id)
);

CREATE INDEX IF NOT EXISTS idx_sh_distributions_dist ON shareholder_distributions(distribution_id);
CREATE INDEX IF NOT EXISTS idx_sh_distributions_sh   ON shareholder_distributions(shareholder_id);
CREATE INDEX IF NOT EXISTS idx_sh_distributions_paid ON shareholder_distributions(paid_status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. COMMISSIONS / PC (marketing person referral tracking)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commissions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  marketing_person  TEXT    NOT NULL,
  mobile            TEXT,
  patient_id        INTEGER,
  bill_id           INTEGER,
  commission_amount INTEGER NOT NULL DEFAULT 0,   -- paisa
  paid_status       TEXT NOT NULL DEFAULT 'unpaid' CHECK(paid_status IN ('unpaid','paid')),
  paid_date         DATE,
  notes             TEXT,
  tenant_id         INTEGER NOT NULL,
  created_by        INTEGER,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (bill_id)    REFERENCES bills(id)
);

CREATE INDEX IF NOT EXISTS idx_commissions_patient    ON commissions(patient_id);
CREATE INDEX IF NOT EXISTS idx_commissions_paid       ON commissions(paid_status);
CREATE INDEX IF NOT EXISTS idx_commissions_tenant     ON commissions(tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. ADD MISSING COLUMNS TO EXISTING TABLES
-- ─────────────────────────────────────────────────────────────────────────────

-- patients: add patient_code for human-readable ID
ALTER TABLE patients ADD COLUMN patient_code TEXT;
CREATE INDEX IF NOT EXISTS idx_patients_patient_code ON patients(patient_code);

-- bills: add invoice_no, visit_id, and status
ALTER TABLE bills ADD COLUMN invoice_no TEXT;
ALTER TABLE bills ADD COLUMN visit_id   INTEGER REFERENCES visits(id);
ALTER TABLE bills ADD COLUMN status     TEXT NOT NULL DEFAULT 'open'
  CHECK(status IN ('open','partially_paid','paid','cancelled'));

CREATE INDEX IF NOT EXISTS idx_bills_invoice_no ON bills(invoice_no);
CREATE INDEX IF NOT EXISTS idx_bills_status     ON bills(status);

-- payments: add settlement_type_id (replacing the CHECK constraint approach)
ALTER TABLE payments ADD COLUMN settlement_type_id INTEGER REFERENCES settlement_types(id);
ALTER TABLE payments ADD COLUMN receipt_no         TEXT;
ALTER TABLE payments ADD COLUMN received_by        INTEGER;
ALTER TABLE payments ADD COLUMN payment_method     TEXT;

-- salary_payments: add bonus, deduction, net_salary, payment_method, reference_no
ALTER TABLE salary_payments ADD COLUMN bonus          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE salary_payments ADD COLUMN deduction      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE salary_payments ADD COLUMN net_salary     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE salary_payments ADD COLUMN payment_method TEXT;
ALTER TABLE salary_payments ADD COLUMN reference_no   TEXT;

-- medicines: add missing fields for proper pharmacy management
ALTER TABLE medicines ADD COLUMN generic_name  TEXT;
ALTER TABLE medicines ADD COLUMN unit          TEXT;
ALTER TABLE medicines ADD COLUMN reorder_level INTEGER NOT NULL DEFAULT 10;
ALTER TABLE medicines ADD COLUMN is_active     INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_medicines_reorder ON medicines(quantity);
CREATE INDEX IF NOT EXISTS idx_medicines_active  ON medicines(is_active);
