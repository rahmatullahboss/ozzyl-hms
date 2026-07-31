-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0143: Full LIS Upgrade
-- Adds: hierarchical test catalog, lab reports/results tables, lab machines,
--        machine test mapping, machine result log, enriches existing tables.
-- References: OpenEMR procedure_type/procedure_providers/procedure_report/procedure_result
--             DanpheEMR LabTest→LabTestComponentMap→LabTestComponent, LIS machine tables
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1a. Hierarchical Test Catalog — enrich lab_test_catalog
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE lab_test_catalog ADD COLUMN parent_id INTEGER REFERENCES lab_test_catalog(id);
ALTER TABLE lab_test_catalog ADD COLUMN test_type TEXT DEFAULT 'single';
-- test_type: 'group' (top-level department), 'panel' (orderable bundle), 'single' (standalone test), 'component' (child of panel)
ALTER TABLE lab_test_catalog ADD COLUMN specimen_type TEXT;
ALTER TABLE lab_test_catalog ADD COLUMN specimen_volume TEXT;
ALTER TABLE lab_test_catalog ADD COLUMN specimen_container TEXT;
ALTER TABLE lab_test_catalog ADD COLUMN department TEXT;
ALTER TABLE lab_test_catalog ADD COLUMN tat_minutes INTEGER;
ALTER TABLE lab_test_catalog ADD COLUMN display_sequence INTEGER DEFAULT 0;
ALTER TABLE lab_test_catalog ADD COLUMN interpretation_template TEXT;
ALTER TABLE lab_test_catalog ADD COLUMN value_type TEXT DEFAULT 'numeric';
-- value_type: 'numeric', 'string', 'memo', 'coded', 'ratio'
ALTER TABLE lab_test_catalog ADD COLUMN is_outsourced INTEGER DEFAULT 0;
ALTER TABLE lab_test_catalog ADD COLUMN outsource_vendor_id INTEGER REFERENCES lab_vendors(id);

CREATE INDEX IF NOT EXISTS idx_lab_test_parent ON lab_test_catalog(parent_id);
CREATE INDEX IF NOT EXISTS idx_lab_test_type ON lab_test_catalog(test_type);
CREATE INDEX IF NOT EXISTS idx_lab_test_dept ON lab_test_catalog(department);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1b. Lab Machines (analyzer/instrument registry)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lab_machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_name TEXT NOT NULL,
  machine_code TEXT NOT NULL,
  machine_type TEXT,
  manufacturer TEXT,
  model_number TEXT,
  serial_number TEXT,
  protocol TEXT DEFAULT 'astm',
  connection_type TEXT DEFAULT 'tcp',
  host_address TEXT,
  port INTEGER,
  baud_rate INTEGER,
  is_bidirectional INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  last_communication_at DATETIME,
  tenant_id TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_machines_tenant ON lab_machines(tenant_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_machines_code ON lab_machines(tenant_id, machine_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1c. Lab Machine Test Mapping (machine code → HMS test code)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lab_machine_test_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES lab_machines(id),
  lab_test_id INTEGER NOT NULL REFERENCES lab_test_catalog(id),
  machine_test_code TEXT NOT NULL,
  machine_test_name TEXT,
  machine_unit TEXT,
  conversion_factor REAL DEFAULT 1.0,
  is_active INTEGER DEFAULT 1,
  tenant_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, machine_id, machine_test_code)
);

CREATE INDEX IF NOT EXISTS idx_lab_mtm_machine ON lab_machine_test_map(machine_id);
CREATE INDEX IF NOT EXISTS idx_lab_mtm_test ON lab_machine_test_map(lab_test_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1d. Lab Machine Result Log (raw ASTM/HL7 message audit trail)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lab_machine_result_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER REFERENCES lab_machines(id),
  raw_message TEXT NOT NULL,
  message_type TEXT,
  parsed_data TEXT,
  processing_status TEXT DEFAULT 'received',
  error_message TEXT,
  matched_order_id INTEGER REFERENCES lab_orders(id),
  matched_item_id INTEGER REFERENCES lab_order_items(id),
  tenant_id TEXT NOT NULL,
  received_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_mrl_machine ON lab_machine_result_log(machine_id);
CREATE INDEX IF NOT EXISTS idx_lab_mrl_tenant ON lab_machine_result_log(tenant_id, received_at);
CREATE INDEX IF NOT EXISTS idx_lab_mrl_status ON lab_machine_result_log(processing_status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1e. Lab Reports (order → report → results hierarchy, like OpenEMR procedure_report)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lab_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_order_id INTEGER NOT NULL REFERENCES lab_orders(id),
  lab_order_item_id INTEGER REFERENCES lab_order_items(id),
  report_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  specimen_num TEXT,
  report_status TEXT DEFAULT 'pending',
  review_status TEXT DEFAULT 'pending',
  reviewed_by INTEGER,
  reviewed_at DATETIME,
  report_notes TEXT,
  pathologist_notes TEXT,
  tenant_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_reports_order ON lab_reports(lab_order_id);
CREATE INDEX IF NOT EXISTS idx_lab_reports_tenant ON lab_reports(tenant_id, report_status);
CREATE INDEX IF NOT EXISTS idx_lab_reports_review ON lab_reports(tenant_id, review_status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1f. Lab Results (individual result values, like OpenEMR procedure_result)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lab_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_report_id INTEGER NOT NULL REFERENCES lab_reports(id),
  lab_test_id INTEGER NOT NULL REFERENCES lab_test_catalog(id),
  result_code TEXT,
  result_text TEXT,
  result_value TEXT,
  result_numeric REAL,
  units TEXT,
  normal_range TEXT,
  abnormal_flag TEXT DEFAULT 'pending',
  result_status TEXT DEFAULT 'preliminary',
  value_type TEXT DEFAULT 'numeric',
  comments TEXT,
  entered_by INTEGER,
  machine_id INTEGER REFERENCES lab_machines(id),
  tenant_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_results_report ON lab_results(lab_report_id);
CREATE INDEX IF NOT EXISTS idx_lab_results_test ON lab_results(lab_test_id);
CREATE INDEX IF NOT EXISTS idx_lab_results_abnormal ON lab_results(tenant_id, abnormal_flag);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1g. Enrich lab_orders
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE lab_orders ADD COLUMN status TEXT DEFAULT 'pending';
ALTER TABLE lab_orders ADD COLUMN priority TEXT DEFAULT 'routine';
ALTER TABLE lab_orders ADD COLUMN specimen_type TEXT;
ALTER TABLE lab_orders ADD COLUMN specimen_fasting TEXT;
ALTER TABLE lab_orders ADD COLUMN clinical_history TEXT;
ALTER TABLE lab_orders ADD COLUMN control_id TEXT;
ALTER TABLE lab_orders ADD COLUMN date_transmitted DATETIME;
ALTER TABLE lab_orders ADD COLUMN machine_id INTEGER REFERENCES lab_machines(id);
ALTER TABLE lab_orders ADD COLUMN vendor_id INTEGER REFERENCES lab_vendors(id);
ALTER TABLE lab_orders ADD COLUMN notes TEXT;

CREATE INDEX IF NOT EXISTS idx_lab_orders_status ON lab_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_lab_orders_priority ON lab_orders(tenant_id, priority);
CREATE INDEX IF NOT EXISTS idx_lab_orders_control ON lab_orders(control_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1h. Enrich lab_order_items
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE lab_order_items ADD COLUMN specimen_type TEXT;
ALTER TABLE lab_order_items ADD COLUMN specimen_num TEXT;
ALTER TABLE lab_order_items ADD COLUMN result_status TEXT DEFAULT 'pending';
ALTER TABLE lab_order_items ADD COLUMN machine_id INTEGER REFERENCES lab_machines(id);
ALTER TABLE lab_order_items ADD COLUMN machine_result_log_id INTEGER REFERENCES lab_machine_result_log(id);
ALTER TABLE lab_order_items ADD COLUMN control_id TEXT;
