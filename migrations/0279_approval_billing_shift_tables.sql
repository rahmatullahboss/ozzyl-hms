-- Runtime tables for approval workflow, bill version history, and shift closing.

CREATE TABLE IF NOT EXISTS approval_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('bill_edit', 'bill_cancel', 'discount', 'refund')),
  entity_id INTEGER NOT NULL,
  entity_no TEXT,
  requested_by INTEGER NOT NULL,
  request_data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  reviewed_by INTEGER,
  reviewed_at TEXT,
  review_notes TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant
  ON approval_requests(tenant_id);

CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant_type_status
  ON approval_requests(tenant_id, type, status);

CREATE INDEX IF NOT EXISTS idx_approval_requests_entity
  ON approval_requests(tenant_id, type, entity_id);

CREATE TABLE IF NOT EXISTS bill_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  bill_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,
  edited_by INTEGER NOT NULL,
  edit_reason TEXT,
  total REAL NOT NULL,
  discount REAL NOT NULL DEFAULT 0,
  discount_reason TEXT,
  tax_total REAL DEFAULT 0,
  due REAL DEFAULT 0,
  test_bill REAL DEFAULT 0,
  admission_bill REAL DEFAULT 0,
  doctor_visit_bill REAL DEFAULT 0,
  operation_bill REAL DEFAULT 0,
  medicine_bill REAL DEFAULT 0,
  items_snapshot TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  UNIQUE(tenant_id, bill_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_bill_versions_bill
  ON bill_versions(tenant_id, bill_id);

CREATE INDEX IF NOT EXISTS idx_bill_versions_bill_version
  ON bill_versions(tenant_id, bill_id, version_number);

CREATE TABLE IF NOT EXISTS shift_closings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  counter_id INTEGER,
  shift_date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT NOT NULL,
  expected_cash REAL NOT NULL DEFAULT 0,
  expected_bkash REAL DEFAULT 0,
  expected_nagad REAL DEFAULT 0,
  expected_card REAL DEFAULT 0,
  expected_bank REAL DEFAULT 0,
  submitted_cash REAL NOT NULL DEFAULT 0,
  submitted_bkash REAL DEFAULT 0,
  submitted_nagad REAL DEFAULT 0,
  submitted_card REAL DEFAULT 0,
  submitted_bank REAL DEFAULT 0,
  cash_short_excess REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  approved_by INTEGER,
  approved_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX IF NOT EXISTS idx_shift_closings_tenant_date
  ON shift_closings(tenant_id, shift_date);

CREATE INDEX IF NOT EXISTS idx_shift_closings_user
  ON shift_closings(tenant_id, user_id);
