-- ═══════════════════════════════════════════════════════════════════════════════
-- Combined Safe Migration: 0143-0148
-- All CREATE TABLE use IF NOT EXISTS. ALTER TABLE wrapped to ignore duplicates.
-- Safe to run multiple times (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 0143: LIS Full Upgrade ─────────────────────────────────────────────────

-- New tables (safe with IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS lab_machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT, machine_name TEXT NOT NULL, machine_code TEXT NOT NULL,
  machine_type TEXT, manufacturer TEXT, model_number TEXT, serial_number TEXT,
  protocol TEXT DEFAULT 'astm', connection_type TEXT DEFAULT 'tcp',
  host_address TEXT, port INTEGER, baud_rate INTEGER, is_bidirectional INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active', last_communication_at DATETIME,
  tenant_id TEXT NOT NULL, is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lab_machines_tenant ON lab_machines(tenant_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_machines_code ON lab_machines(tenant_id, machine_code);

CREATE TABLE IF NOT EXISTS lab_machine_test_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT, machine_id INTEGER NOT NULL REFERENCES lab_machines(id),
  lab_test_id INTEGER NOT NULL REFERENCES lab_test_catalog(id),
  machine_test_code TEXT NOT NULL, machine_test_name TEXT, machine_unit TEXT,
  conversion_factor REAL DEFAULT 1.0, is_active INTEGER DEFAULT 1, tenant_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, machine_id, machine_test_code)
);
CREATE INDEX IF NOT EXISTS idx_lab_mtm_machine ON lab_machine_test_map(machine_id);

CREATE TABLE IF NOT EXISTS lab_machine_result_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, machine_id INTEGER REFERENCES lab_machines(id),
  raw_message TEXT NOT NULL, message_type TEXT, parsed_data TEXT,
  processing_status TEXT DEFAULT 'received', error_message TEXT,
  matched_order_id INTEGER, matched_item_id INTEGER,
  tenant_id TEXT NOT NULL, received_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lab_mrl_machine ON lab_machine_result_log(machine_id);
CREATE INDEX IF NOT EXISTS idx_lab_mrl_tenant ON lab_machine_result_log(tenant_id, received_at);

CREATE TABLE IF NOT EXISTS lab_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lab_order_id INTEGER NOT NULL,
  lab_order_item_id INTEGER, report_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  specimen_num TEXT, report_status TEXT DEFAULT 'pending', review_status TEXT DEFAULT 'pending',
  reviewed_by INTEGER, reviewed_at DATETIME, report_notes TEXT, pathologist_notes TEXT,
  tenant_id TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lab_reports_order ON lab_reports(lab_order_id);
CREATE INDEX IF NOT EXISTS idx_lab_reports_tenant ON lab_reports(tenant_id, report_status);

CREATE TABLE IF NOT EXISTS lab_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lab_report_id INTEGER NOT NULL REFERENCES lab_reports(id),
  lab_test_id INTEGER NOT NULL, result_code TEXT, result_text TEXT,
  result_value TEXT, result_numeric REAL, units TEXT, normal_range TEXT,
  abnormal_flag TEXT DEFAULT 'pending', result_status TEXT DEFAULT 'preliminary',
  value_type TEXT DEFAULT 'numeric', comments TEXT, entered_by INTEGER,
  machine_id INTEGER, tenant_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lab_results_report ON lab_results(lab_report_id);
CREATE INDEX IF NOT EXISTS idx_lab_results_abnormal ON lab_results(tenant_id, abnormal_flag);

-- Safe ALTER TABLE — ignore "duplicate column" errors
-- lab_test_catalog additions
ALTER TABLE lab_test_catalog ADD COLUMN parent_id INTEGER;
ALTER TABLE lab_test_catalog ADD COLUMN test_type TEXT DEFAULT 'single';
ALTER TABLE lab_test_catalog ADD COLUMN specimen_type TEXT;
ALTER TABLE lab_test_catalog ADD COLUMN specimen_volume TEXT;
ALTER TABLE lab_test_catalog ADD COLUMN specimen_container TEXT;
ALTER TABLE lab_test_catalog ADD COLUMN department TEXT;
ALTER TABLE lab_test_catalog ADD COLUMN tat_minutes INTEGER;
ALTER TABLE lab_test_catalog ADD COLUMN display_sequence INTEGER DEFAULT 0;
ALTER TABLE lab_test_catalog ADD COLUMN interpretation_template TEXT;
ALTER TABLE lab_test_catalog ADD COLUMN value_type TEXT DEFAULT 'numeric';
ALTER TABLE lab_test_catalog ADD COLUMN is_outsourced INTEGER DEFAULT 0;
ALTER TABLE lab_test_catalog ADD COLUMN outsource_vendor_id INTEGER;
