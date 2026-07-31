-- Migration 0252: LIS workflow completion
-- Adds first-class lab workflow, department assignment, critical acknowledgement,
-- report delivery, and result correction support on top of the existing LIS stack.

CREATE TABLE IF NOT EXISTS lab_departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  department_code TEXT NOT NULL,
  department_name TEXT NOT NULL,
  queue_prefix TEXT,
  report_header TEXT,
  report_footer TEXT,
  tat_target_minutes INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  tenant_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, department_code)
);

CREATE INDEX IF NOT EXISTS idx_lab_departments_tenant_active
  ON lab_departments(tenant_id, is_active);

WITH normalized_departments AS (
  SELECT
    tenant_id,
    UPPER(REPLACE(TRIM(COALESCE(NULLIF(department, ''), category, 'GENERAL')), ' ', '_')) AS department_code,
    MIN(TRIM(COALESCE(NULLIF(department, ''), category, 'General'))) AS department_name,
    MIN(SUBSTR(UPPER(REPLACE(TRIM(COALESCE(NULLIF(department, ''), category, 'GENERAL')), ' ', '')), 1, 4)) AS queue_prefix
  FROM lab_test_catalog
  WHERE TRIM(COALESCE(NULLIF(department, ''), category, '')) != ''
  GROUP BY
    tenant_id,
    UPPER(REPLACE(TRIM(COALESCE(NULLIF(department, ''), category, 'GENERAL')), ' ', '_'))
)
INSERT INTO lab_departments (department_code, department_name, queue_prefix, tenant_id)
SELECT
  nd.department_code,
  nd.department_name,
  nd.queue_prefix,
  nd.tenant_id
FROM normalized_departments nd
WHERE NOT EXISTS (
  SELECT 1
  FROM lab_departments d
  WHERE d.tenant_id = nd.tenant_id
    AND d.department_code = nd.department_code
);

CREATE TABLE IF NOT EXISTS lab_department_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id INTEGER NOT NULL REFERENCES lab_departments(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  workflow_role TEXT NOT NULL DEFAULT 'lab_technician',
  can_collect INTEGER NOT NULL DEFAULT 0,
  can_receive INTEGER NOT NULL DEFAULT 0,
  can_verify INTEGER NOT NULL DEFAULT 0,
  can_validate INTEGER NOT NULL DEFAULT 0,
  can_deliver INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  tenant_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, department_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lab_department_users_lookup
  ON lab_department_users(tenant_id, user_id, is_active);

CREATE TABLE IF NOT EXISTS lab_workflow_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  event_stage TEXT,
  lab_order_id INTEGER REFERENCES lab_orders(id),
  lab_order_item_id INTEGER REFERENCES lab_order_items(id),
  lab_report_id INTEGER REFERENCES lab_reports(id),
  patient_id INTEGER REFERENCES patients(id),
  from_status TEXT,
  to_status TEXT,
  actor_user_id INTEGER REFERENCES users(id),
  actor_role TEXT,
  notes TEXT,
  metadata_json TEXT,
  tenant_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_workflow_events_order
  ON lab_workflow_events(tenant_id, lab_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_workflow_events_item
  ON lab_workflow_events(tenant_id, lab_order_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_workflow_events_report
  ON lab_workflow_events(tenant_id, lab_report_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lab_critical_acknowledgements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_order_item_id INTEGER NOT NULL REFERENCES lab_order_items(id),
  acknowledged_by INTEGER NOT NULL REFERENCES users(id),
  acknowledged_to TEXT,
  notes TEXT,
  tenant_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_critical_ack_item
  ON lab_critical_acknowledgements(tenant_id, lab_order_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lab_report_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_report_id INTEGER NOT NULL REFERENCES lab_reports(id),
  lab_order_id INTEGER NOT NULL REFERENCES lab_orders(id),
  delivery_method TEXT NOT NULL DEFAULT 'print',
  recipient_name TEXT,
  recipient_contact TEXT,
  copy_count INTEGER NOT NULL DEFAULT 1,
  delivered_by INTEGER NOT NULL REFERENCES users(id),
  notes TEXT,
  tenant_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_report_deliveries_report
  ON lab_report_deliveries(tenant_id, lab_report_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lab_result_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_report_id INTEGER NOT NULL REFERENCES lab_reports(id),
  lab_result_id INTEGER NOT NULL REFERENCES lab_results(id),
  previous_result_value TEXT,
  previous_result_numeric REAL,
  new_result_value TEXT,
  new_result_numeric REAL,
  correction_reason TEXT NOT NULL,
  correction_notes TEXT,
  corrected_by INTEGER NOT NULL REFERENCES users(id),
  tenant_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_result_corrections_report
  ON lab_result_corrections(tenant_id, lab_report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_result_corrections_result
  ON lab_result_corrections(tenant_id, lab_result_id, created_at DESC);

ALTER TABLE lab_reports ADD COLUMN validated_by INTEGER REFERENCES users(id);
ALTER TABLE lab_reports ADD COLUMN validated_at DATETIME;
ALTER TABLE lab_reports ADD COLUMN published_at DATETIME;
ALTER TABLE lab_reports ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE lab_reports ADD COLUMN corrected_at DATETIME;
ALTER TABLE lab_reports ADD COLUMN correction_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE lab_order_items ADD COLUMN received_at DATETIME;
ALTER TABLE lab_order_items ADD COLUMN received_by INTEGER REFERENCES users(id);
ALTER TABLE lab_order_items ADD COLUMN recollection_requested_at DATETIME;
ALTER TABLE lab_order_items ADD COLUMN recollection_requested_by INTEGER REFERENCES users(id);
ALTER TABLE lab_order_items ADD COLUMN sample_container TEXT;
ALTER TABLE lab_order_items ADD COLUMN department_id INTEGER REFERENCES lab_departments(id);

CREATE INDEX IF NOT EXISTS idx_lab_order_items_received
  ON lab_order_items(tenant_id, received_at);
CREATE INDEX IF NOT EXISTS idx_lab_order_items_department
  ON lab_order_items(tenant_id, department_id, status);
CREATE INDEX IF NOT EXISTS idx_lab_reports_delivery_status
  ON lab_reports(tenant_id, delivery_status, report_status);
