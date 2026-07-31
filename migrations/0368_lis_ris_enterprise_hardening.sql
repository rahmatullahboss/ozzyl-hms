-- Migration 0368: LIS/RIS enterprise hardening
-- Adds first-class specimen/accession tracking, structured observation audit,
-- local bridge registry, unmatched result work queues, and RIS reconciliation.

CREATE TABLE IF NOT EXISTS lab_specimens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  lab_order_id INTEGER NOT NULL REFERENCES lab_orders(id),
  patient_id INTEGER REFERENCES patients(id),
  accession_no TEXT NOT NULL,
  specimen_barcode TEXT NOT NULL,
  specimen_type TEXT,
  container_type TEXT,
  collection_site TEXT,
  collection_priority TEXT NOT NULL DEFAULT 'routine',
  fasting_status TEXT,
  collection_status TEXT NOT NULL DEFAULT 'ordered',
  collected_by INTEGER REFERENCES users(id),
  collected_at DATETIME,
  received_by INTEGER REFERENCES users(id),
  received_at DATETIME,
  rejected_by INTEGER REFERENCES users(id),
  rejected_at DATETIME,
  rejection_reason_id INTEGER REFERENCES lab_rejection_reasons(id),
  rejection_notes TEXT,
  parent_specimen_id INTEGER REFERENCES lab_specimens(id),
  storage_location TEXT,
  transport_condition TEXT,
  external_lab_reference TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, accession_no),
  UNIQUE(tenant_id, specimen_barcode)
);

CREATE INDEX IF NOT EXISTS idx_lab_specimens_order
  ON lab_specimens(tenant_id, lab_order_id, collection_status);
CREATE INDEX IF NOT EXISTS idx_lab_specimens_patient
  ON lab_specimens(tenant_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_specimens_barcode
  ON lab_specimens(tenant_id, specimen_barcode);

CREATE TABLE IF NOT EXISTS lab_specimen_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  specimen_id INTEGER NOT NULL REFERENCES lab_specimens(id),
  lab_order_item_id INTEGER NOT NULL REFERENCES lab_order_items(id),
  lab_test_id INTEGER REFERENCES lab_test_catalog(id),
  aliquot_label TEXT,
  is_primary INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, specimen_id, lab_order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_lab_specimen_items_item
  ON lab_specimen_items(tenant_id, lab_order_item_id);

CREATE TABLE IF NOT EXISTS lab_specimen_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  specimen_id INTEGER NOT NULL REFERENCES lab_specimens(id),
  lab_order_id INTEGER REFERENCES lab_orders(id),
  lab_order_item_id INTEGER REFERENCES lab_order_items(id),
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_user_id INTEGER REFERENCES users(id),
  actor_role TEXT,
  location TEXT,
  notes TEXT,
  metadata_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_specimen_events_specimen
  ON lab_specimen_events(tenant_id, specimen_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_specimen_events_order
  ON lab_specimen_events(tenant_id, lab_order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lab_observation_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  lab_result_id INTEGER REFERENCES lab_results(id),
  lab_order_item_id INTEGER REFERENCES lab_order_items(id),
  lab_test_id INTEGER REFERENCES lab_test_catalog(id),
  component_id INTEGER REFERENCES lab_test_components(id),
  specimen_id INTEGER REFERENCES lab_specimens(id),
  result_value TEXT,
  result_numeric REAL,
  units TEXT,
  reference_range TEXT,
  abnormal_flag TEXT,
  critical_flag INTEGER NOT NULL DEFAULT 0,
  result_status TEXT NOT NULL DEFAULT 'preliminary',
  observation_source TEXT NOT NULL DEFAULT 'manual',
  machine_id INTEGER REFERENCES lab_machines(id),
  machine_result_log_id INTEGER REFERENCES lab_machine_result_log(id),
  reagent_lot TEXT,
  control_lot TEXT,
  method TEXT,
  entered_by INTEGER REFERENCES users(id),
  verified_by INTEGER REFERENCES users(id),
  verified_at DATETIME,
  correction_reason TEXT,
  version_no INTEGER NOT NULL DEFAULT 1,
  supersedes_observation_id INTEGER REFERENCES lab_observation_audit(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_observation_audit_item
  ON lab_observation_audit(tenant_id, lab_order_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_observation_audit_result
  ON lab_observation_audit(tenant_id, lab_result_id, version_no DESC);
CREATE INDEX IF NOT EXISTS idx_lab_observation_audit_specimen
  ON lab_observation_audit(tenant_id, specimen_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lis_bridge_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  agent_code TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  site_name TEXT,
  host_fingerprint TEXT,
  version TEXT,
  status TEXT NOT NULL DEFAULT 'inactive',
  last_seen_at DATETIME,
  last_error TEXT,
  capabilities_json TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, agent_code)
);

CREATE INDEX IF NOT EXISTS idx_lis_bridge_agents_status
  ON lis_bridge_agents(tenant_id, status, last_seen_at);

CREATE TABLE IF NOT EXISTS lis_unmatched_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  machine_id INTEGER REFERENCES lab_machines(id),
  bridge_agent_id INTEGER REFERENCES lis_bridge_agents(id),
  machine_result_log_id INTEGER REFERENCES lab_machine_result_log(id),
  identifier_type TEXT,
  identifier_value TEXT,
  machine_test_code TEXT,
  result_payload_json TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'unmatched',
  status TEXT NOT NULL DEFAULT 'open',
  resolved_by INTEGER REFERENCES users(id),
  resolved_at DATETIME,
  resolved_lab_order_item_id INTEGER REFERENCES lab_order_items(id),
  resolution_notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lis_unmatched_results_open
  ON lis_unmatched_results(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lis_unmatched_results_identifier
  ON lis_unmatched_results(tenant_id, identifier_type, identifier_value);

CREATE TABLE IF NOT EXISTS ris_study_reconciliation_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  requisition_id INTEGER REFERENCES radiology_requisitions(id),
  dicom_study_id INTEGER REFERENCES radiology_dicom_studies(id),
  accession_no TEXT,
  study_instance_uid TEXT,
  patient_id INTEGER REFERENCES patients(id),
  patient_name TEXT,
  modality TEXT,
  issue_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  suggested_match_json TEXT,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at DATETIME,
  resolution_notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ris_reconcile_open
  ON ris_study_reconciliation_queue(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ris_reconcile_accession
  ON ris_study_reconciliation_queue(tenant_id, accession_no);

ALTER TABLE lab_order_items ADD COLUMN specimen_id INTEGER REFERENCES lab_specimens(id);
ALTER TABLE lab_order_items ADD COLUMN accession_no TEXT;

CREATE INDEX IF NOT EXISTS idx_lab_order_items_specimen
  ON lab_order_items(tenant_id, specimen_id);
CREATE INDEX IF NOT EXISTS idx_lab_order_items_accession
  ON lab_order_items(tenant_id, accession_no);
