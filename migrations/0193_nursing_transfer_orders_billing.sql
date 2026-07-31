-- Patient Transfer (Ward-to-Ward)
CREATE TABLE IF NOT EXISTS nur_patient_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER NOT NULL,
  from_ward_id INTEGER NOT NULL,
  from_bed_id INTEGER,
  to_ward_id INTEGER NOT NULL,
  to_bed_id INTEGER,
  transfer_reason TEXT,
  transferred_by TEXT,
  transferred_on TEXT DEFAULT (datetime('now', '+6 hours')),
  received_by TEXT,
  received_on TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'received', 'cancelled')),
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_patient_transfers_visit
  ON nur_patient_transfers(tenant_id, visit_id, status);

CREATE INDEX IF NOT EXISTS idx_patient_transfers_pending
  ON nur_patient_transfers(tenant_id, to_ward_id, status);

-- Nursing Orders (Lab/Radiology/Procedure)
CREATE TABLE IF NOT EXISTS nur_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER NOT NULL,
  order_type TEXT NOT NULL CHECK(order_type IN ('lab', 'radiology', 'procedure', 'other')),
  item_name TEXT NOT NULL,
  item_id INTEGER,
  service_department_id INTEGER,
  quantity INTEGER DEFAULT 1,
  priority TEXT DEFAULT 'routine' CHECK(priority IN ('stat', 'urgent', 'routine')),
  instructions TEXT,
  ordered_by INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'completed', 'cancelled')),
  is_active INTEGER DEFAULT 1,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_nursing_orders_visit
  ON nur_orders(tenant_id, visit_id, is_active);

CREATE INDEX IF NOT EXISTS idx_nursing_orders_status
  ON nur_orders(tenant_id, status, is_active);

-- Drug Requisition (Nursing to Pharmacy)
CREATE TABLE IF NOT EXISTS nur_drug_requisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER,
  visit_id INTEGER,
  ward_id INTEGER,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'dispensed', 'cancelled')),
  remarks TEXT,
  requested_by TEXT,
  requested_on TEXT DEFAULT (datetime('now', '+6 hours')),
  dispensed_by TEXT,
  dispensed_on TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS nur_drug_requisition_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  requisition_id INTEGER NOT NULL,
  drug_name TEXT NOT NULL,
  generic_name TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit TEXT DEFAULT 'tablets',
  remarks TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX IF NOT EXISTS idx_drug_requisitions_visit
  ON nur_drug_requisitions(tenant_id, visit_id, is_active);

CREATE INDEX IF NOT EXISTS idx_drug_requisitions_status
  ON nur_drug_requisitions(tenant_id, ward_id, status);

CREATE INDEX IF NOT EXISTS idx_drug_requisition_items_req
  ON nur_drug_requisition_items(tenant_id, requisition_id);

-- Ward Billing Requests (IP Provisional Billing from Nursing)
CREATE TABLE IF NOT EXISTS nur_ward_billing_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  item_id INTEGER,
  service_department_id INTEGER,
  quantity INTEGER DEFAULT 1,
  price REAL,
  total_amount REAL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'billed', 'cancelled')),
  requested_by TEXT,
  requested_on TEXT DEFAULT (datetime('now', '+6 hours')),
  approved_by TEXT,
  approved_on TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ward_billing_visit
  ON nur_ward_billing_requests(tenant_id, visit_id, is_active);

CREATE INDEX IF NOT EXISTS idx_ward_billing_status
  ON nur_ward_billing_requests(tenant_id, status, is_active);
