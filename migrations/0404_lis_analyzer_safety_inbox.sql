-- Migration 0404: LIS analyzer safety inbox
-- Stages analyzer messages/observations before any canonical clinical result write.

CREATE TABLE IF NOT EXISTS lis_ingestion_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  machine_id INTEGER NOT NULL REFERENCES lab_machines(id),
  bridge_agent_id INTEGER REFERENCES lis_bridge_agents(id),
  machine_result_log_id INTEGER REFERENCES lab_machine_result_log(id),
  protocol TEXT NOT NULL,
  message_identity TEXT NOT NULL,
  source_message_id TEXT,
  delivery_id TEXT,
  payload_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processing', 'completed', 'partial', 'rejected', 'collision', 'error')),
  raw_payload TEXT NOT NULL,
  parse_errors_json TEXT,
  outcome_json TEXT,
  error_message TEXT,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, machine_id, message_identity)
);

CREATE INDEX IF NOT EXISTS idx_lis_ingestion_messages_status
  ON lis_ingestion_messages(tenant_id, status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_lis_ingestion_messages_delivery
  ON lis_ingestion_messages(tenant_id, delivery_id)
  WHERE delivery_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lis_ingestion_messages_hash
  ON lis_ingestion_messages(tenant_id, machine_id, payload_sha256);

CREATE TRIGGER IF NOT EXISTS trg_lis_ingestion_message_evidence_immutable
BEFORE UPDATE ON lis_ingestion_messages
FOR EACH ROW
WHEN
  NEW.tenant_id IS NOT OLD.tenant_id OR
  NEW.machine_id IS NOT OLD.machine_id OR
  NEW.bridge_agent_id IS NOT OLD.bridge_agent_id OR
  NEW.machine_result_log_id IS NOT OLD.machine_result_log_id OR
  NEW.protocol IS NOT OLD.protocol OR
  NEW.message_identity IS NOT OLD.message_identity OR
  NEW.source_message_id IS NOT OLD.source_message_id OR
  NEW.delivery_id IS NOT OLD.delivery_id OR
  NEW.payload_sha256 IS NOT OLD.payload_sha256 OR
  NEW.raw_payload IS NOT OLD.raw_payload OR
  NEW.received_at IS NOT OLD.received_at OR
  NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'immutable ingestion evidence cannot be modified');
END;

CREATE TABLE IF NOT EXISTS lis_bridge_request_nonces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  request_timestamp INTEGER NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, key_id, nonce)
);

CREATE INDEX IF NOT EXISTS idx_lis_bridge_request_nonces_expiry
  ON lis_bridge_request_nonces(expires_at);

CREATE TABLE IF NOT EXISTS lis_ingestion_collisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  machine_id INTEGER NOT NULL REFERENCES lab_machines(id),
  original_message_id INTEGER NOT NULL REFERENCES lis_ingestion_messages(id),
  message_identity TEXT NOT NULL,
  incoming_payload_sha256 TEXT NOT NULL,
  incoming_raw_payload TEXT NOT NULL,
  delivery_id TEXT,
  reason TEXT NOT NULL DEFAULT 'identity_payload_mismatch',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lis_ingestion_collisions_original
  ON lis_ingestion_collisions(tenant_id, original_message_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lis_analyzer_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  ingestion_message_id INTEGER NOT NULL REFERENCES lis_ingestion_messages(id),
  observation_index INTEGER NOT NULL,
  order_group_index INTEGER,
  machine_id INTEGER NOT NULL REFERENCES lab_machines(id),
  bridge_agent_id INTEGER REFERENCES lis_bridge_agents(id),
  machine_result_log_id INTEGER REFERENCES lab_machine_result_log(id),

  identifier_type TEXT,
  identifier_value TEXT,
  machine_test_code TEXT NOT NULL,
  machine_test_name TEXT,
  analyzer_observation_id TEXT,

  lab_order_item_id INTEGER REFERENCES lab_order_items(id),
  patient_id INTEGER REFERENCES patients(id),
  specimen_id INTEGER REFERENCES lab_specimens(id),
  lab_test_id INTEGER REFERENCES lab_test_catalog(id),
  component_id INTEGER REFERENCES lab_test_components(id),
  candidate_metadata_json TEXT,

  raw_value TEXT NOT NULL,
  raw_units TEXT,
  raw_reference_range TEXT,
  normalized_value TEXT,
  normalized_numeric REAL,
  normalized_units TEXT,
  selected_reference_range TEXT,
  conversion_rule TEXT,
  conversion_factor REAL,

  analyzer_result_status TEXT,
  normalized_result_status TEXT,
  analyzer_abnormal_flag TEXT,
  normalized_interpretation TEXT,
  critical_flag INTEGER NOT NULL DEFAULT 0 CHECK (critical_flag IN (0, 1)),

  match_state TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_state IN ('unmatched', 'ambiguous', 'exact', 'invalid')),
  qc_state TEXT NOT NULL DEFAULT 'not_run'
    CHECK (qc_state IN ('pass', 'fail', 'not_run', 'stale', 'config_missing', 'system_error', 'override')),
  validation_state TEXT NOT NULL DEFAULT 'not_run'
    CHECK (validation_state IN ('pass', 'fail', 'not_run', 'incomplete', 'system_error', 'override')),
  disposition TEXT NOT NULL DEFAULT 'received'
    CHECK (disposition IN (
      'received', 'parsed', 'unmatched', 'ambiguous', 'qc_blocked',
      'validation_blocked', 'review_required', 'acceptance_eligible',
      'accepted', 'rejected', 'superseded', 'error'
    )),
  disposition_reason TEXT,
  state_version INTEGER NOT NULL DEFAULT 1 CHECK (state_version >= 1),

  source_payload_json TEXT NOT NULL,
  validation_details_json TEXT,
  qc_details_json TEXT,
  staged_by INTEGER REFERENCES users(id),
  accepted_by INTEGER REFERENCES users(id),
  accepted_at DATETIME,
  rejected_by INTEGER REFERENCES users(id),
  rejected_at DATETIME,
  rejection_reason TEXT,
  supersedes_inbox_id INTEGER REFERENCES lis_analyzer_inbox(id),
  canonical_lab_result_id INTEGER,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ingestion_message_id, observation_index)
);

CREATE INDEX IF NOT EXISTS idx_lis_analyzer_inbox_work_queue
  ON lis_analyzer_inbox(tenant_id, disposition, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lis_analyzer_inbox_order_item
  ON lis_analyzer_inbox(tenant_id, lab_order_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lis_analyzer_inbox_patient
  ON lis_analyzer_inbox(tenant_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lis_analyzer_inbox_identifier
  ON lis_analyzer_inbox(tenant_id, identifier_type, identifier_value, machine_test_code);

CREATE TRIGGER IF NOT EXISTS trg_lis_analyzer_inbox_evidence_immutable
BEFORE UPDATE ON lis_analyzer_inbox
FOR EACH ROW
WHEN
  NEW.tenant_id IS NOT OLD.tenant_id OR
  NEW.ingestion_message_id IS NOT OLD.ingestion_message_id OR
  NEW.observation_index IS NOT OLD.observation_index OR
  NEW.order_group_index IS NOT OLD.order_group_index OR
  NEW.machine_id IS NOT OLD.machine_id OR
  NEW.bridge_agent_id IS NOT OLD.bridge_agent_id OR
  NEW.machine_result_log_id IS NOT OLD.machine_result_log_id OR
  NEW.identifier_type IS NOT OLD.identifier_type OR
  NEW.identifier_value IS NOT OLD.identifier_value OR
  NEW.machine_test_code IS NOT OLD.machine_test_code OR
  NEW.machine_test_name IS NOT OLD.machine_test_name OR
  NEW.analyzer_observation_id IS NOT OLD.analyzer_observation_id OR
  NEW.lab_order_item_id IS NOT OLD.lab_order_item_id OR
  NEW.patient_id IS NOT OLD.patient_id OR
  NEW.specimen_id IS NOT OLD.specimen_id OR
  NEW.lab_test_id IS NOT OLD.lab_test_id OR
  NEW.component_id IS NOT OLD.component_id OR
  NEW.candidate_metadata_json IS NOT OLD.candidate_metadata_json OR
  NEW.raw_value IS NOT OLD.raw_value OR
  NEW.raw_units IS NOT OLD.raw_units OR
  NEW.raw_reference_range IS NOT OLD.raw_reference_range OR
  NEW.normalized_value IS NOT OLD.normalized_value OR
  NEW.normalized_numeric IS NOT OLD.normalized_numeric OR
  NEW.normalized_units IS NOT OLD.normalized_units OR
  NEW.selected_reference_range IS NOT OLD.selected_reference_range OR
  NEW.conversion_rule IS NOT OLD.conversion_rule OR
  NEW.conversion_factor IS NOT OLD.conversion_factor OR
  NEW.analyzer_result_status IS NOT OLD.analyzer_result_status OR
  NEW.normalized_result_status IS NOT OLD.normalized_result_status OR
  NEW.analyzer_abnormal_flag IS NOT OLD.analyzer_abnormal_flag OR
  NEW.normalized_interpretation IS NOT OLD.normalized_interpretation OR
  NEW.critical_flag IS NOT OLD.critical_flag OR
  NEW.match_state IS NOT OLD.match_state OR
  NEW.qc_state IS NOT OLD.qc_state OR
  NEW.validation_state IS NOT OLD.validation_state OR
  NEW.source_payload_json IS NOT OLD.source_payload_json OR
  NEW.validation_details_json IS NOT OLD.validation_details_json OR
  NEW.qc_details_json IS NOT OLD.qc_details_json OR
  NEW.staged_by IS NOT OLD.staged_by OR
  NEW.supersedes_inbox_id IS NOT OLD.supersedes_inbox_id OR
  NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'immutable analyzer evidence cannot be modified');
END;

ALTER TABLE lab_results
  ADD COLUMN lis_analyzer_inbox_id INTEGER REFERENCES lis_analyzer_inbox(id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_lab_results_lis_inbox
  ON lab_results(tenant_id, lis_analyzer_inbox_id)
  WHERE lis_analyzer_inbox_id IS NOT NULL;

ALTER TABLE lab_observation_audit
  ADD COLUMN lis_analyzer_inbox_id INTEGER REFERENCES lis_analyzer_inbox(id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_lab_observation_audit_lis_inbox
  ON lab_observation_audit(tenant_id, lis_analyzer_inbox_id)
  WHERE lis_analyzer_inbox_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lis_result_acceptance_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  lis_analyzer_inbox_id INTEGER NOT NULL REFERENCES lis_analyzer_inbox(id),
  expected_version INTEGER NOT NULL CHECK (expected_version >= 1),
  reviewer_user_id INTEGER NOT NULL REFERENCES users(id),
  reviewer_role TEXT NOT NULL,
  command_status TEXT NOT NULL DEFAULT 'claimed'
    CHECK (command_status IN ('claimed', 'completed')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  UNIQUE (tenant_id, lis_analyzer_inbox_id)
);

CREATE INDEX IF NOT EXISTS idx_lis_result_acceptance_commands_reviewer
  ON lis_result_acceptance_commands(tenant_id, reviewer_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lis_critical_event_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  lis_analyzer_inbox_id INTEGER NOT NULL REFERENCES lis_analyzer_inbox(id),
  event_type TEXT NOT NULL DEFAULT 'critical_result',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'delivered', 'acknowledged', 'escalated', 'failed', 'cancelled')),
  payload_json TEXT NOT NULL,
  recipient_policy_json TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at DATETIME,
  acknowledgement_deadline DATETIME,
  acknowledged_by INTEGER REFERENCES users(id),
  acknowledged_at DATETIME,
  acknowledgement_note TEXT,
  last_error TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, lis_analyzer_inbox_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_lis_critical_event_outbox_dispatch
  ON lis_critical_event_outbox(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_lis_critical_event_outbox_tenant
  ON lis_critical_event_outbox(tenant_id, status, created_at DESC);
