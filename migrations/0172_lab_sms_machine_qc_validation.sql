-- Migration 0172: SMS Templates + Machine Orders + Downtime + QC + Calibration + Validation
PRAGMA foreign_keys = ON;

-- SMS Templates
CREATE TABLE IF NOT EXISTS lab_sms_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_name TEXT NOT NULL,
  template_text TEXT NOT NULL,
  template_type TEXT DEFAULT 'sms' CHECK(template_type IN ('sms','email')),
  is_active INTEGER NOT NULL DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Machine Orders (bidirectional LIS)
CREATE TABLE IF NOT EXISTS lab_machine_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES lab_machines(id),
  lab_order_id INTEGER NOT NULL,
  lab_order_item_id INTEGER,
  machine_test_code TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','sent','acknowledged','completed','failed')),
  sent_at DATETIME,
  acknowledged_at DATETIME,
  raw_request TEXT,
  raw_response TEXT,
  error_message TEXT,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lab_machine_orders_machine ON lab_machine_orders(machine_id, status);

-- Machine Downtime
CREATE TABLE IF NOT EXISTS lab_machine_downtime (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES lab_machines(id),
  downtime_start DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  downtime_end DATETIME,
  reason TEXT,
  resolved_by INTEGER,
  resolution_notes TEXT,
  tenant_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lab_downtime_machine ON lab_machine_downtime(machine_id);

-- QC Controls
CREATE TABLE IF NOT EXISTS lab_qc_controls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  control_name TEXT NOT NULL,
  control_code TEXT NOT NULL,
  control_lot TEXT,
  manufacturer TEXT,
  expiry_date DATE,
  is_active INTEGER NOT NULL DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- QC Ranges
CREATE TABLE IF NOT EXISTS lab_qc_ranges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  control_id INTEGER NOT NULL REFERENCES lab_qc_controls(id),
  lab_test_id INTEGER NOT NULL REFERENCES lab_test_catalog(id),
  component_id INTEGER REFERENCES lab_test_components(id),
  mean_value REAL NOT NULL,
  sd_value REAL NOT NULL,
  range_low REAL,
  range_high REAL,
  qc_level INTEGER DEFAULT 1 CHECK(qc_level IN (1,2,3)),
  is_active INTEGER NOT NULL DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lab_qc_ranges_control ON lab_qc_ranges(control_id);

-- QC Results
CREATE TABLE IF NOT EXISTS lab_qc_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  control_id INTEGER NOT NULL REFERENCES lab_qc_controls(id),
  lab_test_id INTEGER NOT NULL,
  qc_range_id INTEGER REFERENCES lab_qc_ranges(id),
  result_value REAL NOT NULL,
  run_date DATE NOT NULL DEFAULT CURRENT_DATE,
  run_number INTEGER,
  machine_id INTEGER REFERENCES lab_machines(id),
  technician_id INTEGER,
  is_out_of_range INTEGER NOT NULL DEFAULT 0,
  westgard_violations TEXT,
  action_taken TEXT,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lab_qc_results_control ON lab_qc_results(control_id, run_date);

-- Calibrations
CREATE TABLE IF NOT EXISTS lab_calibrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES lab_machines(id),
  calibration_type TEXT DEFAULT 'routine' CHECK(calibration_type IN ('routine','preventive','corrective','annual')),
  scheduled_date DATE NOT NULL,
  performed_date DATE,
  performed_by INTEGER,
  result_status TEXT DEFAULT 'pending' CHECK(result_status IN ('pass','fail','pending','cancelled')),
  calibration_values TEXT,
  certificate_no TEXT,
  next_due_date DATE,
  notes TEXT,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lab_calibration_machine ON lab_calibrations(machine_id, scheduled_date);

-- Validation Rules
CREATE TABLE IF NOT EXISTS lab_validation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_test_id INTEGER NOT NULL REFERENCES lab_test_catalog(id),
  component_id INTEGER REFERENCES lab_test_components(id),
  rule_type TEXT NOT NULL CHECK(rule_type IN ('range','mandatory','dependency','delta','custom')),
  rule_config TEXT NOT NULL,
  error_message TEXT,
  error_message_bn TEXT,
  is_blocking INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lab_validation_test ON lab_validation_rules(lab_test_id, is_active);
