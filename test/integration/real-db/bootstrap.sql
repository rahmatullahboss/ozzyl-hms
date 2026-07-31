-- =============================================================================
-- HMS Bootstrap Schema — EXACT COPY from Production D1
-- =============================================================================
-- Dumped from production D1 (f5ec1282-94e9-4574-b49c-19b50c03ed53) on 2026-03-16
-- via: SELECT sql FROM sqlite_master WHERE type='table'
--
-- These are the ORIGINAL tables that existed BEFORE the numbered migrations
-- (0001–0037). They must be applied to local D1 after schema.sql (tenants,
-- users) and before the numbered migrations.
-- =============================================================================

-- ─── SERIALS (daily patient queue) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS serials (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id     INTEGER NOT NULL,
    serial_number  TEXT NOT NULL,
    date           DATE NOT NULL,
    status         TEXT DEFAULT 'waiting' CHECK(status IN ('waiting','serving','done','skipped')),
    tenant_id      INTEGER NOT NULL,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

-- ─── PATIENTS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    father_husband TEXT NOT NULL,
    address TEXT NOT NULL,
    mobile TEXT NOT NULL,
    guardian_mobile TEXT,
    age INTEGER,
    gender TEXT CHECK(gender IN ('male', 'female', 'other')),
    blood_group TEXT,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    patient_code TEXT,
    branch_id INTEGER,
    email TEXT,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- ─── DOCTORS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctors (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  specialty         TEXT,
  mobile_number     TEXT,
  consultation_fee  INTEGER NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1,
  tenant_id         INTEGER NOT NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  bmdc_reg_no TEXT,
  qualifications TEXT,
  visiting_hours TEXT,
  public_bio TEXT,
  is_public INTEGER DEFAULT 1,
  photo_key TEXT
);

-- ─── VISITS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id      INTEGER NOT NULL,
  visit_no        TEXT,
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
  icd10_code TEXT,
  icd10_description TEXT,
  branch_id INTEGER,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (doctor_id)  REFERENCES doctors(id)
);

-- ─── BILLS ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    test_bill REAL DEFAULT 0,
    admission_bill REAL DEFAULT 0,
    doctor_visit_bill REAL DEFAULT 0,
    operation_bill REAL DEFAULT 0,
    medicine_bill REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    paid REAL DEFAULT 0,
    due REAL DEFAULT 0,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    invoice_no TEXT,
    visit_id   INTEGER REFERENCES visits(id),
    status     TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','partially_paid','paid','cancelled','refunded')),
    branch_id INTEGER,
    subtotal REAL NOT NULL DEFAULT 0,
    created_by INTEGER,
    cancelled_by INTEGER,
    cancelled_at TEXT,
    cancel_reason TEXT,
    settlement_id INTEGER,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

-- ─── PAYMENTS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_type TEXT CHECK(payment_type IN ('current', 'due')),
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    tenant_id INTEGER NOT NULL,
    settlement_type_id INTEGER,
    receipt_no         TEXT,
    received_by        INTEGER,
    payment_method     TEXT,
    type TEXT DEFAULT 'current',
    idempotency_key TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bill_id) REFERENCES bills(id)
);

-- ─── MEDICINES ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medicines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company TEXT,
    unit_price REAL NOT NULL,
    quantity INTEGER DEFAULT 0,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    generic_name  TEXT,
    unit          TEXT,
    reorder_level INTEGER NOT NULL DEFAULT 10,
    is_active     INTEGER NOT NULL DEFAULT 1
);

-- ─── SUPPLIERS ────────────────────────────────────────────────────────────────
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

-- ─── MEDICINE PURCHASES ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medicine_purchases (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_no     TEXT,
  supplier_id     INTEGER,
  purchase_date   DATE    NOT NULL,
  subtotal        INTEGER NOT NULL DEFAULT 0,
  discount_total  INTEGER NOT NULL DEFAULT 0,
  total_amount    INTEGER NOT NULL DEFAULT 0,
  paid_amount     INTEGER NOT NULL DEFAULT 0,
  due_amount      INTEGER NOT NULL DEFAULT 0,
  tenant_id       INTEGER NOT NULL,
  created_by      INTEGER,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

-- ─── MEDICINE PURCHASE ITEMS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medicine_purchase_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id     INTEGER NOT NULL,
  medicine_id     INTEGER NOT NULL,
  batch_no        TEXT,
  expiry_date     DATE,
  quantity        INTEGER NOT NULL,
  purchase_price  INTEGER NOT NULL,
  sale_price      INTEGER NOT NULL,
  line_total      INTEGER NOT NULL,
  tenant_id       INTEGER NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES medicine_purchases(id),
  FOREIGN KEY (medicine_id) REFERENCES medicines(id)
);

-- ─── MEDICINE STOCK BATCHES ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medicine_stock_batches (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  medicine_id         INTEGER NOT NULL,
  batch_no            TEXT,
  expiry_date         DATE,
  quantity_received   INTEGER NOT NULL,
  quantity_available  INTEGER NOT NULL,
  purchase_price      INTEGER NOT NULL DEFAULT 0,
  sale_price          INTEGER NOT NULL DEFAULT 0,
  purchase_item_id    INTEGER,
  tenant_id           INTEGER NOT NULL,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medicine_id)      REFERENCES medicines(id),
  FOREIGN KEY (purchase_item_id) REFERENCES medicine_purchase_items(id)
);

-- ─── MEDICINE STOCK MOVEMENTS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medicine_stock_movements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  medicine_id    INTEGER NOT NULL,
  batch_id       INTEGER,
  movement_type  TEXT NOT NULL CHECK(movement_type IN ('purchase_in','sale_out','adjustment','return','expired')),
  quantity       INTEGER NOT NULL,
  unit_cost      INTEGER,
  unit_price     INTEGER,
  reference_type TEXT,
  reference_id   INTEGER,
  movement_date  DATE    NOT NULL,
  tenant_id      INTEGER NOT NULL,
  created_by     INTEGER,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medicine_id) REFERENCES medicines(id),
  FOREIGN KEY (batch_id)    REFERENCES medicine_stock_batches(id)
);

-- ─── LAB TEST CATALOG ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_test_catalog (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  category    TEXT,
  price       INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  tenant_id   INTEGER NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  unit TEXT,
  normal_range TEXT,
  method TEXT,
  critical_low  REAL,
  critical_high REAL
);

-- ─── LAB ORDERS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no        TEXT,
  patient_id      INTEGER NOT NULL,
  visit_id        INTEGER,
  ordered_by      INTEGER,
  order_date      DATE    NOT NULL,
  prescription_id INTEGER,
  print_count     INTEGER NOT NULL DEFAULT 0,
  last_printed_at DATETIME,
  tenant_id       INTEGER NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'sent',
  diagnosis TEXT,
  relevant_history TEXT,
  fasting_required INTEGER NOT NULL DEFAULT 0,
  specimen_type TEXT DEFAULT 'Blood',
  collection_notes TEXT,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (visit_id)   REFERENCES visits(id)
);

-- ─── LAB ORDER ITEMS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_order_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_order_id     INTEGER NOT NULL,
  lab_test_id      INTEGER NOT NULL,
  test_name        TEXT,
  unit_price       INTEGER NOT NULL DEFAULT 0,
  discount         INTEGER NOT NULL DEFAULT 0,
  line_total       INTEGER NOT NULL DEFAULT 0,
  result           TEXT,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed')),
  completed_at     DATETIME,
  tenant_id        INTEGER NOT NULL,
  priority TEXT NOT NULL DEFAULT 'routine',
  instructions TEXT,
  result_numeric REAL,
  abnormal_flag TEXT DEFAULT 'pending',
  sample_status TEXT DEFAULT 'ordered',
  collected_at DATETIME,
  processed_by INTEGER,
  FOREIGN KEY (lab_order_id) REFERENCES lab_orders(id),
  FOREIGN KEY (lab_test_id)  REFERENCES lab_test_catalog(id)
);

-- ─── PRESCRIPTIONS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prescriptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  rx_no           TEXT    NOT NULL,
  patient_id      INTEGER NOT NULL REFERENCES patients(id),
  doctor_id       INTEGER REFERENCES doctors(id),
  appointment_id  INTEGER,
  bp              TEXT,
  temperature     TEXT,
  weight          TEXT,
  spo2            TEXT,
  chief_complaint TEXT,
  diagnosis       TEXT,
  examination_notes TEXT,
  advice          TEXT,
  lab_tests       TEXT,
  follow_up_date  TEXT,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','final')),
  created_by      INTEGER NOT NULL,
  tenant_id       TEXT    NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  dispense_status TEXT NOT NULL DEFAULT 'pending'
);

-- ─── PRESCRIPTION ITEMS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prescription_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  prescription_id INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medicine_name   TEXT NOT NULL,
  dosage          TEXT,
  frequency       TEXT,
  duration        TEXT,
  instructions    TEXT,
  sort_order      INTEGER DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 0,
  dispensed_qty INTEGER NOT NULL DEFAULT 0,
  medicine_id INTEGER REFERENCES medicines(id)
);

-- ─── INVOICE ITEMS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id        INTEGER NOT NULL,
  item_category  TEXT    NOT NULL CHECK(item_category IN ('test','doctor_visit','operation','medicine','admission','other')),
  description    TEXT,
  quantity       INTEGER NOT NULL DEFAULT 1,
  unit_price     INTEGER NOT NULL,
  line_total     INTEGER NOT NULL,
  reference_id   INTEGER,
  tenant_id      INTEGER NOT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'active',
  cancelled_by INTEGER,
  cancelled_at TEXT,
  cancel_reason TEXT,
  FOREIGN KEY (bill_id) REFERENCES bills(id)
);

-- ─── SETTLEMENT TYPES ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settlement_types (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  tenant_id  INTEGER NOT NULL
);

-- ─── SEQUENCE COUNTERS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sequence_counters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  counter_type  TEXT    NOT NULL,
  prefix        TEXT    NOT NULL DEFAULT '',
  current_value INTEGER NOT NULL DEFAULT 0,
  tenant_id     INTEGER NOT NULL,
  UNIQUE(counter_type, tenant_id)
);

-- ─── STAFF ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    position TEXT NOT NULL,
    salary REAL NOT NULL,
    bank_account TEXT NOT NULL,
    mobile TEXT NOT NULL,
    joining_date DATE,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─── SALARY PAYMENTS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salary_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_date DATE NOT NULL,
    month TEXT NOT NULL,
    tenant_id INTEGER NOT NULL,
    bonus          INTEGER NOT NULL DEFAULT 0,
    deduction      INTEGER NOT NULL DEFAULT 0,
    net_salary     INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT,
    reference_no   TEXT,
    FOREIGN KEY (staff_id) REFERENCES staff(id)
);

-- ─── INCOME ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS income (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other')),
    amount REAL NOT NULL,
    description TEXT,
    bill_id INTEGER,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    branch_id INTEGER,
    FOREIGN KEY (bill_id) REFERENCES bills(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ─── EXPENSES ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'approved' CHECK(status IN ('pending', 'approved', 'rejected')),
    approved_by INTEGER,
    approved_at DATETIME,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    branch_id INTEGER,
    FOREIGN KEY (approved_by) REFERENCES users(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ─── SHAREHOLDERS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shareholders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    phone TEXT NOT NULL,
    share_count INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('profit', 'owner')),
    investment REAL NOT NULL,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    email TEXT,
    nid TEXT,
    bank_name TEXT,
    bank_account_no TEXT,
    bank_branch TEXT,
    routing_no TEXT,
    share_value_bdt INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    user_id INTEGER,
    nominee_name TEXT,
    nominee_contact TEXT
);

-- ─── SHAREHOLDER DISTRIBUTIONS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shareholder_distributions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  distribution_id     INTEGER NOT NULL,
  shareholder_id      INTEGER NOT NULL,
  share_count         INTEGER NOT NULL,
  per_share_amount    INTEGER NOT NULL,
  distribution_amount INTEGER NOT NULL,
  paid_status         TEXT NOT NULL DEFAULT 'unpaid' CHECK(paid_status IN ('unpaid','paid')),
  paid_date           DATE,
  notes               TEXT,
  tenant_id           INTEGER NOT NULL,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (shareholder_id)  REFERENCES shareholders(id)
);

-- ─── COMMISSIONS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commissions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  marketing_person  TEXT    NOT NULL,
  mobile            TEXT,
  patient_id        INTEGER,
  bill_id           INTEGER,
  commission_amount INTEGER NOT NULL DEFAULT 0,
  paid_status       TEXT NOT NULL DEFAULT 'unpaid' CHECK(paid_status IN ('unpaid','paid')),
  paid_date         DATE,
  notes             TEXT,
  tenant_id         INTEGER NOT NULL,
  created_by        INTEGER,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (bill_id)    REFERENCES bills(id)
);

-- ─── DOCTOR SCHEDULES ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctor_schedules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id    INTEGER NOT NULL,
  doctor_id    INTEGER NOT NULL,
  day_of_week  TEXT NOT NULL CHECK(day_of_week IN ('sun','mon','tue','wed','thu','fri','sat')),
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  session_type TEXT NOT NULL DEFAULT 'morning' CHECK(session_type IN ('morning','afternoon','evening','night')),
  chamber      TEXT,
  max_patients INTEGER NOT NULL DEFAULT 20,
  is_active    INTEGER NOT NULL DEFAULT 1,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── SETTINGS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "settings" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    tenant_id INTEGER NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(key, tenant_id)
);
