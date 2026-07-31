-- Migration: 0187_danphe_operational_gap_closure.sql
-- Closes high-priority Danphe EMR operational gaps for OT, Finance, HR, Assets, and MRD.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Operation Theatre / Surgery
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE ot_bookings ADD COLUMN operation_status TEXT DEFAULT 'scheduled'
  CHECK(operation_status IN ('scheduled','pre_op','in_progress','completed','cancelled'));
ALTER TABLE ot_bookings ADD COLUMN operation_started_at TEXT;
ALTER TABLE ot_bookings ADD COLUMN operation_completed_at TEXT;

CREATE TABLE IF NOT EXISTS ot_surgery_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  booking_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER,
  operative_procedure TEXT NOT NULL,
  operative_findings TEXT,
  complications TEXT,
  implants_or_specimens TEXT,
  blood_loss_ml REAL,
  incision_start_time TEXT,
  closure_time TEXT,
  surgeon_staff_id INTEGER,
  note_status TEXT DEFAULT 'draft' CHECK(note_status IN ('draft','final','amended')),
  finalized_by TEXT,
  finalized_on TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (booking_id) REFERENCES ot_bookings(id)
);
CREATE INDEX IF NOT EXISTS idx_ot_surgery_notes_booking ON ot_surgery_notes(tenant_id, booking_id);
CREATE INDEX IF NOT EXISTS idx_ot_surgery_notes_patient ON ot_surgery_notes(tenant_id, patient_id);

CREATE TABLE IF NOT EXISTS ot_anesthesia_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  booking_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER,
  anesthetist_staff_id INTEGER,
  anesthesia_type TEXT,
  asa_class TEXT,
  airway_plan TEXT,
  pre_anesthesia_assessment TEXT,
  intraoperative_vitals_json TEXT,
  medications_json TEXT,
  fluids_json TEXT,
  complications TEXT,
  recovery_notes TEXT,
  record_status TEXT DEFAULT 'draft' CHECK(record_status IN ('draft','final','amended')),
  finalized_by TEXT,
  finalized_on TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (booking_id) REFERENCES ot_bookings(id)
);
CREATE INDEX IF NOT EXISTS idx_ot_anesthesia_booking ON ot_anesthesia_records(tenant_id, booking_id);
CREATE INDEX IF NOT EXISTS idx_ot_anesthesia_patient ON ot_anesthesia_records(tenant_id, patient_id);

CREATE TABLE IF NOT EXISTS ot_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  booking_id INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  remarks TEXT,
  performed_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (booking_id) REFERENCES ot_bookings(id)
);
CREATE INDEX IF NOT EXISTS idx_ot_status_events_booking ON ot_status_events(tenant_id, booking_id, created_at);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Accounts / Finance
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE expenses ADD COLUMN source_type TEXT;
ALTER TABLE expenses ADD COLUMN source_id INTEGER;
ALTER TABLE expenses ADD COLUMN reference_no TEXT;

CREATE TABLE IF NOT EXISTS accounting_vendor_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  vendor_id INTEGER NOT NULL,
  vendor_name TEXT,
  goods_receipt_id INTEGER,
  payment_date TEXT NOT NULL,
  total_amount REAL DEFAULT 0,
  paid_amount REAL NOT NULL,
  remaining_amount REAL DEFAULT 0,
  payment_mode TEXT DEFAULT 'cash' CHECK(payment_mode IN ('cash','bank','cheque','card','mobile_banking','other')),
  receiver_account_id INTEGER,
  expense_id INTEGER,
  journal_entry_id INTEGER,
  remarks TEXT,
  status TEXT DEFAULT 'posted' CHECK(status IN ('posted','void')),
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  voided_by TEXT,
  voided_on TEXT,
  FOREIGN KEY (vendor_id) REFERENCES InventoryVendor(VendorId),
  FOREIGN KEY (goods_receipt_id) REFERENCES InventoryGoodsReceipt(GoodsReceiptId),
  FOREIGN KEY (expense_id) REFERENCES expenses(id),
  FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id)
);
CREATE INDEX IF NOT EXISTS idx_vendor_payments_tenant_vendor ON accounting_vendor_payments(tenant_id, vendor_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_vendor_payments_gr ON accounting_vendor_payments(tenant_id, goods_receipt_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. HR & Payroll
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hr_leave_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  leave_category_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  days REAL NOT NULL DEFAULT 0,
  pay_percent REAL NOT NULL DEFAULT 100,
  is_active INTEGER DEFAULT 1,
  is_approved INTEGER DEFAULT 0,
  approved_by TEXT,
  approved_on TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (leave_category_id) REFERENCES hr_leave_categories(id),
  UNIQUE(tenant_id, leave_category_id, year)
);
CREATE INDEX IF NOT EXISTS idx_hr_leave_rules_year ON hr_leave_rules(tenant_id, year);

ALTER TABLE hr_payslips ADD COLUMN attendance_summary_json TEXT;
ALTER TABLE hr_payslips ADD COLUMN leave_deduction REAL DEFAULT 0;
ALTER TABLE hr_payslips ADD COLUMN payable_days REAL;
ALTER TABLE hr_payroll_runs ADD COLUMN expense_id INTEGER;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Asset Management
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS asset_insurance_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  asset_stock_id INTEGER NOT NULL,
  policy_number TEXT NOT NULL,
  insurer_name TEXT NOT NULL,
  insured_value REAL DEFAULT 0,
  premium_amount REAL DEFAULT 0,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  file_key TEXT,
  file_name TEXT,
  remarks TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','expired','cancelled')),
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (asset_stock_id) REFERENCES InventoryFixedAssetStock(FixedAssetStockId)
);
CREATE INDEX IF NOT EXISTS idx_asset_insurance_asset ON asset_insurance_policies(tenant_id, asset_stock_id);
CREATE INDEX IF NOT EXISTS idx_asset_insurance_expiry ON asset_insurance_policies(tenant_id, end_date);

CREATE TABLE IF NOT EXISTS asset_contract_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  asset_stock_id INTEGER NOT NULL,
  amc_contract_id INTEGER,
  contract_type TEXT NOT NULL,
  contract_number TEXT,
  vendor_name TEXT,
  file_key TEXT NOT NULL,
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT,
  effective_from TEXT,
  effective_to TEXT,
  uploaded_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (asset_stock_id) REFERENCES InventoryFixedAssetStock(FixedAssetStockId),
  FOREIGN KEY (amc_contract_id) REFERENCES asset_amc_contracts(id)
);
CREATE INDEX IF NOT EXISTS idx_asset_contract_docs_asset ON asset_contract_documents(tenant_id, asset_stock_id);
CREATE INDEX IF NOT EXISTS idx_asset_contract_docs_amc ON asset_contract_documents(tenant_id, amc_contract_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 5. MRD
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mrd_chart_completion_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  medical_record_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER,
  admission_id INTEGER,
  task_type TEXT NOT NULL CHECK(task_type IN ('chart_review','icd_coding','discharge_summary','doctor_signature','nurse_notes','billing_clearance','other')),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','waived')),
  assigned_to INTEGER,
  due_date TEXT,
  completed_by TEXT,
  completed_on TEXT,
  remarks TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (medical_record_id) REFERENCES medical_records(id),
  FOREIGN KEY (patient_id) REFERENCES patients(id)
);
CREATE INDEX IF NOT EXISTS idx_mrd_chart_tasks_record ON mrd_chart_completion_tasks(tenant_id, medical_record_id);
CREATE INDEX IF NOT EXISTS idx_mrd_chart_tasks_status ON mrd_chart_completion_tasks(tenant_id, status, due_date);

CREATE TABLE IF NOT EXISTS mrd_discharge_summary_archives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  medical_record_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER,
  discharge_summary_no TEXT,
  discharge_date TEXT,
  file_key TEXT NOT NULL,
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT,
  archived_by TEXT,
  archived_at TEXT DEFAULT (datetime('now')),
  version INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1,
  remarks TEXT,
  FOREIGN KEY (medical_record_id) REFERENCES medical_records(id),
  FOREIGN KEY (patient_id) REFERENCES patients(id)
);
CREATE INDEX IF NOT EXISTS idx_mrd_archive_record ON mrd_discharge_summary_archives(tenant_id, medical_record_id);
CREATE INDEX IF NOT EXISTS idx_mrd_archive_patient ON mrd_discharge_summary_archives(tenant_id, patient_id);

CREATE TABLE IF NOT EXISTS mrd_medico_legal_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  medical_record_id INTEGER,
  patient_id INTEGER NOT NULL,
  mlc_case_id INTEGER,
  file_type TEXT NOT NULL CHECK(file_type IN ('police_requisition','injury_report','sample_chain','court_order','final_opinion','other')),
  file_key TEXT,
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','sealed','released','archived')),
  custodian_staff_id INTEGER,
  released_to TEXT,
  released_on TEXT,
  remarks TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (medical_record_id) REFERENCES medical_records(id),
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (mlc_case_id) REFERENCES mlc_cases(id)
);
CREATE INDEX IF NOT EXISTS idx_mrd_mlc_files_patient ON mrd_medico_legal_files(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_mrd_mlc_files_case ON mrd_medico_legal_files(tenant_id, mlc_case_id);
