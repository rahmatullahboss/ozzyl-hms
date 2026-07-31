-- Migration 0182: Diagnostic LIS/RIS production readiness
-- Adds explicit bill linkage and payment-clearance tracking to lab/radiology
-- orders. Also rebuilds lab_order_items so its status CHECK matches the
-- production sample lifecycle already used by the application.

ALTER TABLE lab_orders ADD COLUMN bill_id INTEGER REFERENCES bills(id);
ALTER TABLE lab_orders ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'not_required';
ALTER TABLE lab_orders ADD COLUMN payment_cleared_at DATETIME;
ALTER TABLE lab_orders ADD COLUMN updated_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_lab_orders_bill_gate
  ON lab_orders(tenant_id, bill_id, billing_status);

ALTER TABLE radiology_requisitions ADD COLUMN bill_id INTEGER REFERENCES bills(id);
ALTER TABLE radiology_requisitions ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'not_required';
ALTER TABLE radiology_requisitions ADD COLUMN payment_cleared_at DATETIME;
ALTER TABLE radiology_requisitions ADD COLUMN accession_no TEXT;

CREATE INDEX IF NOT EXISTS idx_rad_req_bill_gate
  ON radiology_requisitions(tenant_id, bill_id, billing_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rad_req_accession
  ON radiology_requisitions(tenant_id, accession_no)
  WHERE accession_no IS NOT NULL;

ALTER TABLE lab_machine_test_map ADD COLUMN component_id INTEGER REFERENCES lab_test_components(id);
CREATE INDEX IF NOT EXISTS idx_lab_mtm_component
  ON lab_machine_test_map(component_id);

ALTER TABLE lab_machine_result_log ADD COLUMN updated_at DATETIME;

ALTER TABLE lab_reports ADD COLUMN reported_by INTEGER;
ALTER TABLE lab_reports ADD COLUMN review_notes TEXT;

ALTER TABLE lab_order_items ADD COLUMN notes TEXT;
ALTER TABLE lab_order_items ADD COLUMN updated_at DATETIME;
ALTER TABLE lab_order_items ADD COLUMN barcode TEXT;
ALTER TABLE lab_order_items ADD COLUMN verified_by INTEGER REFERENCES users(id);
ALTER TABLE lab_order_items ADD COLUMN verified_at DATETIME;
ALTER TABLE lab_order_items ADD COLUMN hl7_device_id TEXT;
ALTER TABLE lab_order_items ADD COLUMN source TEXT NOT NULL DEFAULT 'lab';

PRAGMA foreign_keys = OFF;

CREATE TABLE lab_order_items_rebuild_0179 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_order_id INTEGER NOT NULL,
  lab_test_id INTEGER NOT NULL,
  unit_price INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  line_total INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','collected','received','processing','completed','verified','rejected','cancelled')),
  completed_at DATETIME,
  tenant_id INTEGER NOT NULL,
  result_numeric REAL,
  abnormal_flag TEXT DEFAULT 'pending',
  sample_status TEXT DEFAULT 'ordered',
  collected_at DATETIME,
  processed_by INTEGER,
  priority TEXT NOT NULL DEFAULT 'routine',
  instructions TEXT,
  barcode TEXT,
  verified_by INTEGER REFERENCES users(id),
  verified_at DATETIME,
  hl7_device_id TEXT,
  source TEXT NOT NULL DEFAULT 'lab',
  specimen_type TEXT,
  specimen_num TEXT,
  result_status TEXT DEFAULT 'pending',
  machine_id INTEGER REFERENCES lab_machines(id),
  machine_result_log_id INTEGER REFERENCES lab_machine_result_log(id),
  control_id TEXT,
  rejection_reason_id INTEGER REFERENCES lab_rejection_reasons(id),
  rejected_by INTEGER,
  rejected_at DATETIME,
  rejection_notes TEXT,
  notes TEXT,
  updated_at DATETIME,
  FOREIGN KEY (lab_order_id) REFERENCES lab_orders(id),
  FOREIGN KEY (lab_test_id) REFERENCES lab_test_catalog(id)
);

INSERT INTO lab_order_items_rebuild_0179 (
  id, lab_order_id, lab_test_id, unit_price, discount, line_total, result,
  status, completed_at, tenant_id, result_numeric, abnormal_flag, sample_status,
  collected_at, processed_by, priority, instructions, barcode, verified_by,
  verified_at, hl7_device_id, source, specimen_type, specimen_num, result_status,
  machine_id, machine_result_log_id, control_id, rejection_reason_id, rejected_by,
  rejected_at, rejection_notes, notes, updated_at
)
SELECT
  id, lab_order_id, lab_test_id, unit_price, discount, line_total, result,
  status, completed_at, tenant_id, result_numeric, abnormal_flag, sample_status,
  collected_at, processed_by, priority, instructions, barcode, verified_by,
  verified_at, hl7_device_id, source, specimen_type, specimen_num, result_status,
  machine_id, machine_result_log_id, control_id, rejection_reason_id, rejected_by,
  rejected_at, rejection_notes, notes, updated_at
FROM lab_order_items;

DROP TABLE lab_order_items;
ALTER TABLE lab_order_items_rebuild_0179 RENAME TO lab_order_items;

CREATE INDEX IF NOT EXISTS idx_lab_order_items_order
  ON lab_order_items(lab_order_id);
CREATE INDEX IF NOT EXISTS idx_lab_order_items_test
  ON lab_order_items(lab_test_id);
CREATE INDEX IF NOT EXISTS idx_lab_order_items_status
  ON lab_order_items(status);
CREATE INDEX IF NOT EXISTS idx_lab_order_items_sample_status
  ON lab_order_items(sample_status);
CREATE INDEX IF NOT EXISTS idx_lab_order_items_abnormal
  ON lab_order_items(abnormal_flag);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_order_items_barcode
  ON lab_order_items(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lab_order_items_verified
  ON lab_order_items(verified_by);

PRAGMA foreign_keys = ON;
