-- =============================================================================
-- HMS Canonical Lab Result and Specimen Authority
-- Additive-only specimen custody, immutable result versions/observations,
-- signature lifecycle, and analyzer provenance. Existing LIS tables remain
-- compatibility sources until separately authorised cutover.
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_encounters_lab_patient_scope
  ON canonical_encounters(tenant_id, encounter_public_id, patient_link_public_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_service_requests_lab_scope
  ON canonical_service_requests(tenant_id, request_public_id, encounter_public_id, service_public_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_service_requests_lab_service_scope
  ON canonical_service_requests(tenant_id, request_public_id, service_public_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_service_events_lab_scope
  ON canonical_service_events(tenant_id, event_public_id, request_public_id, encounter_public_id, service_public_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_service_events_lab_service_scope
  ON canonical_service_events(tenant_id, event_public_id, request_public_id, service_public_id);

CREATE TABLE IF NOT EXISTS canonical_lab_specimens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  specimen_public_id TEXT NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  primary_request_public_id TEXT NOT NULL,
  primary_service_public_id TEXT NOT NULL,
  accession_namespace TEXT NOT NULL,
  accession_value TEXT NOT NULL,
  barcode_namespace TEXT NOT NULL,
  barcode_value TEXT NOT NULL,
  specimen_type_code TEXT NOT NULL,
  container_code TEXT,
  parent_specimen_public_id TEXT,
  current_status TEXT NOT NULL DEFAULT 'registered',
  status_version INTEGER NOT NULL DEFAULT 1,
  current_status_event_public_id TEXT,
  collected_at_utc TEXT,
  received_at_utc TEXT,
  rejected_at_utc TEXT,
  disposed_at_utc TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  idempotency_key TEXT NOT NULL,
  request_fingerprint_sha256 TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (current_status IN ('registered','collected','in_transit','received','processing','rejected','disposed','entered_in_error')),
  CHECK (status_version > 0),
  CHECK (length(trim(accession_namespace)) > 0 AND length(trim(accession_value)) > 0),
  CHECK (length(trim(barcode_namespace)) > 0 AND length(trim(barcode_value)) > 0),
  CHECK (length(trim(specimen_type_code)) > 0),
  CHECK (parent_specimen_public_id IS NULL OR parent_specimen_public_id != specimen_public_id),
  CHECK (actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL),
  CHECK ((collected_at_utc IS NULL OR substr(collected_at_utc,-1)='Z') AND (received_at_utc IS NULL OR substr(received_at_utc,-1)='Z') AND (rejected_at_utc IS NULL OR substr(rejected_at_utc,-1)='Z') AND (disposed_at_utc IS NULL OR substr(disposed_at_utc,-1)='Z') AND substr(created_at_utc,-1)='Z' AND substr(updated_at_utc,-1)='Z'),
  CHECK (length(request_fingerprint_sha256)=64 AND request_fingerprint_sha256=lower(request_fingerprint_sha256) AND request_fingerprint_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(source_evidence_sha256)=64 AND source_evidence_sha256=lower(source_evidence_sha256) AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  FOREIGN KEY (tenant_id,patient_link_public_id) REFERENCES canonical_tenant_patient_links(tenant_id,patient_link_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,encounter_public_id,patient_link_public_id) REFERENCES canonical_encounters(tenant_id,encounter_public_id,patient_link_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,primary_request_public_id,encounter_public_id,primary_service_public_id) REFERENCES canonical_service_requests(tenant_id,request_public_id,encounter_public_id,service_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,primary_service_public_id) REFERENCES canonical_service_catalog_items(tenant_id,service_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,parent_specimen_public_id,patient_link_public_id,encounter_public_id) REFERENCES canonical_lab_specimens(tenant_id,specimen_public_id,patient_link_public_id,encounter_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,specimen_public_id,current_status_event_public_id) REFERENCES canonical_lab_specimen_status_events(tenant_id,specimen_public_id,event_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,specimen_public_id),
  UNIQUE (tenant_id,specimen_public_id,patient_link_public_id,encounter_public_id),
  UNIQUE (tenant_id,specimen_public_id,primary_request_public_id,primary_service_public_id),
  UNIQUE (tenant_id,accession_namespace,accession_value),
  UNIQUE (tenant_id,barcode_namespace,barcode_value),
  UNIQUE (tenant_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_canonical_lab_specimens_patient_status ON canonical_lab_specimens(tenant_id,patient_link_public_id,current_status,specimen_public_id);
CREATE INDEX IF NOT EXISTS idx_canonical_lab_specimens_request ON canonical_lab_specimens(tenant_id,primary_request_public_id,current_status,specimen_public_id);

CREATE TABLE IF NOT EXISTS canonical_lab_specimen_service_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  link_public_id TEXT NOT NULL,
  specimen_public_id TEXT NOT NULL,
  request_public_id TEXT NOT NULL,
  event_public_id TEXT,
  service_public_id TEXT NOT NULL,
  relationship_role TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (relationship_role IN ('primary','aliquot','reflex','repeat')),
  CHECK (length(source_evidence_sha256)=64 AND source_evidence_sha256=lower(source_evidence_sha256) AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (substr(created_at_utc,-1)='Z'),
  FOREIGN KEY (tenant_id,specimen_public_id,request_public_id,service_public_id) REFERENCES canonical_lab_specimens(tenant_id,specimen_public_id,primary_request_public_id,primary_service_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,request_public_id,service_public_id) REFERENCES canonical_service_requests(tenant_id,request_public_id,service_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,event_public_id,request_public_id,service_public_id) REFERENCES canonical_service_events(tenant_id,event_public_id,request_public_id,service_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,service_public_id) REFERENCES canonical_service_catalog_items(tenant_id,service_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,link_public_id),
  UNIQUE (tenant_id,specimen_public_id,request_public_id,relationship_role)
);

CREATE TABLE IF NOT EXISTS canonical_lab_specimen_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  event_public_id TEXT NOT NULL,
  specimen_public_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_practitioner_public_id TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  occurred_at_utc TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  location_source_type TEXT,
  location_source_public_id TEXT,
  collection_method_code TEXT,
  transport_condition_code TEXT,
  reason_code TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (from_status IS NULL OR from_status IN ('registered','collected','in_transit','received','processing','rejected','disposed','entered_in_error')),
  CHECK (to_status IN ('registered','collected','in_transit','received','processing','rejected','disposed','entered_in_error')),
  CHECK (event_version > 0),
  CHECK (event_type IN ('registered','collected','transferred','received','processing_started','rejected','aliquoted','disposed','entered_in_error')),
  CHECK (actor_practitioner_public_id IS NOT NULL OR actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL),
  CHECK ((location_source_type IS NULL AND location_source_public_id IS NULL) OR (location_source_type IS NOT NULL AND location_source_public_id IS NOT NULL)),
  CHECK (length(trim(reason_code)) > 0),
  CHECK (substr(occurred_at_utc,-1)='Z' AND substr(recorded_at_utc,-1)='Z' AND recorded_at_utc>=occurred_at_utc AND substr(created_at_utc,-1)='Z'),
  CHECK (length(source_evidence_sha256)=64 AND source_evidence_sha256=lower(source_evidence_sha256) AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  FOREIGN KEY (tenant_id,specimen_public_id) REFERENCES canonical_lab_specimens(tenant_id,specimen_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,actor_practitioner_public_id) REFERENCES canonical_practitioners(tenant_id,practitioner_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,event_public_id),
  UNIQUE (tenant_id,specimen_public_id,event_public_id),
  UNIQUE (tenant_id,specimen_public_id,event_version)
);
CREATE INDEX IF NOT EXISTS idx_canonical_lab_specimen_events_timeline ON canonical_lab_specimen_status_events(tenant_id,specimen_public_id,event_version,occurred_at_utc);

CREATE TABLE IF NOT EXISTS canonical_lab_result_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  result_set_public_id TEXT NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  request_public_id TEXT NOT NULL,
  event_public_id TEXT,
  specimen_public_id TEXT NOT NULL,
  service_public_id TEXT NOT NULL,
  current_version_public_id TEXT,
  current_status TEXT NOT NULL DEFAULT 'draft',
  status_version INTEGER NOT NULL DEFAULT 1,
  current_status_event_public_id TEXT,
  creating_practitioner_public_id TEXT NOT NULL,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  idempotency_key TEXT NOT NULL,
  request_fingerprint_sha256 TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (current_status IN ('draft','verified','validated','published','retracted','entered_in_error')),
  CHECK (status_version > 0),
  CHECK (actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL),
  CHECK (length(request_fingerprint_sha256)=64 AND request_fingerprint_sha256=lower(request_fingerprint_sha256) AND request_fingerprint_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(source_evidence_sha256)=64 AND source_evidence_sha256=lower(source_evidence_sha256) AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (substr(created_at_utc,-1)='Z' AND substr(updated_at_utc,-1)='Z'),
  FOREIGN KEY (tenant_id,patient_link_public_id) REFERENCES canonical_tenant_patient_links(tenant_id,patient_link_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,encounter_public_id,patient_link_public_id) REFERENCES canonical_encounters(tenant_id,encounter_public_id,patient_link_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,request_public_id,encounter_public_id,service_public_id) REFERENCES canonical_service_requests(tenant_id,request_public_id,encounter_public_id,service_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,event_public_id,request_public_id,encounter_public_id,service_public_id) REFERENCES canonical_service_events(tenant_id,event_public_id,request_public_id,encounter_public_id,service_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,specimen_public_id,patient_link_public_id,encounter_public_id) REFERENCES canonical_lab_specimens(tenant_id,specimen_public_id,patient_link_public_id,encounter_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,specimen_public_id,request_public_id,service_public_id) REFERENCES canonical_lab_specimens(tenant_id,specimen_public_id,primary_request_public_id,primary_service_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,service_public_id) REFERENCES canonical_service_catalog_items(tenant_id,service_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,creating_practitioner_public_id) REFERENCES canonical_practitioners(tenant_id,practitioner_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,result_set_public_id,current_version_public_id) REFERENCES canonical_lab_result_versions(tenant_id,result_set_public_id,version_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,result_set_public_id,current_status_event_public_id) REFERENCES canonical_lab_result_status_events(tenant_id,result_set_public_id,event_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,result_set_public_id),
  UNIQUE (tenant_id,result_set_public_id,patient_link_public_id,encounter_public_id,request_public_id,specimen_public_id,service_public_id),
  UNIQUE (tenant_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_canonical_lab_result_sets_patient_status ON canonical_lab_result_sets(tenant_id,patient_link_public_id,current_status,result_set_public_id);
CREATE INDEX IF NOT EXISTS idx_canonical_lab_result_sets_request_status ON canonical_lab_result_sets(tenant_id,request_public_id,current_status,result_set_public_id);

CREATE TABLE IF NOT EXISTS canonical_lab_result_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  version_public_id TEXT NOT NULL,
  result_set_public_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  supersedes_version_public_id TEXT,
  version_kind TEXT NOT NULL,
  version_status TEXT NOT NULL DEFAULT 'draft',
  content_sha256 TEXT NOT NULL,
  signed_content_sha256 TEXT,
  authoring_practitioner_public_id TEXT NOT NULL,
  verifying_practitioner_public_id TEXT,
  validating_practitioner_public_id TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  authored_at_utc TEXT NOT NULL,
  verified_at_utc TEXT,
  validated_at_utc TEXT,
  published_at_utc TEXT,
  retracted_at_utc TEXT,
  reason_code TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (version_number > 0),
  CHECK (version_kind IN ('draft','correction','amendment','retraction','entered_in_error')),
  CHECK (version_status IN ('draft','verified','validated','published','retracted','entered_in_error')),
  CHECK ((version_kind='draft' AND supersedes_version_public_id IS NULL) OR (version_kind IN ('correction','amendment','retraction','entered_in_error') AND supersedes_version_public_id IS NOT NULL AND supersedes_version_public_id!=version_public_id)),
  CHECK (actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL),
  CHECK ((version_status='draft' AND signed_content_sha256 IS NULL AND verifying_practitioner_public_id IS NULL AND validating_practitioner_public_id IS NULL AND verified_at_utc IS NULL AND validated_at_utc IS NULL AND published_at_utc IS NULL AND retracted_at_utc IS NULL) OR (version_status IN ('verified','validated','published') AND signed_content_sha256=content_sha256) OR version_status IN ('retracted','entered_in_error')),
  CHECK (length(content_sha256)=64 AND content_sha256=lower(content_sha256) AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (signed_content_sha256 IS NULL OR (length(signed_content_sha256)=64 AND signed_content_sha256=lower(signed_content_sha256) AND signed_content_sha256 NOT GLOB '*[^0-9a-f]*')),
  CHECK (version_kind NOT IN ('correction','amendment','retraction','entered_in_error') OR (reason_code IS NOT NULL AND length(trim(reason_code))>0)),
  CHECK (substr(authored_at_utc,-1)='Z' AND (verified_at_utc IS NULL OR substr(verified_at_utc,-1)='Z') AND (validated_at_utc IS NULL OR substr(validated_at_utc,-1)='Z') AND (published_at_utc IS NULL OR substr(published_at_utc,-1)='Z') AND (retracted_at_utc IS NULL OR substr(retracted_at_utc,-1)='Z') AND substr(created_at_utc,-1)='Z'),
  CHECK (length(source_evidence_sha256)=64 AND source_evidence_sha256=lower(source_evidence_sha256) AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  FOREIGN KEY (tenant_id,result_set_public_id) REFERENCES canonical_lab_result_sets(tenant_id,result_set_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,result_set_public_id,supersedes_version_public_id) REFERENCES canonical_lab_result_versions(tenant_id,result_set_public_id,version_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,authoring_practitioner_public_id) REFERENCES canonical_practitioners(tenant_id,practitioner_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,verifying_practitioner_public_id) REFERENCES canonical_practitioners(tenant_id,practitioner_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,validating_practitioner_public_id) REFERENCES canonical_practitioners(tenant_id,practitioner_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,version_public_id),
  UNIQUE (tenant_id,result_set_public_id,version_public_id),
  UNIQUE (tenant_id,result_set_public_id,version_number),
  UNIQUE (tenant_id,result_set_public_id,supersedes_version_public_id)
);
CREATE INDEX IF NOT EXISTS idx_canonical_lab_result_versions_timeline ON canonical_lab_result_versions(tenant_id,result_set_public_id,version_number,version_public_id);

CREATE TABLE IF NOT EXISTS canonical_lab_result_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  observation_public_id TEXT NOT NULL,
  result_set_public_id TEXT NOT NULL,
  version_public_id TEXT NOT NULL,
  observation_sequence INTEGER NOT NULL,
  service_public_id TEXT NOT NULL,
  component_source_type TEXT NOT NULL,
  component_source_public_id TEXT NOT NULL,
  observation_code TEXT NOT NULL,
  code_system TEXT NOT NULL,
  display_snapshot TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_text TEXT,
  value_decimal TEXT,
  value_code TEXT,
  value_code_system TEXT,
  value_boolean INTEGER,
  value_date_time_utc TEXT,
  unit_code TEXT,
  reference_low_decimal TEXT,
  reference_high_decimal TEXT,
  reference_text TEXT,
  interpretation_code TEXT,
  method_code TEXT,
  specimen_public_id TEXT NOT NULL,
  observation_status TEXT NOT NULL,
  reason_code TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (observation_sequence > 0),
  CHECK (length(trim(component_source_type))>0 AND length(trim(component_source_public_id))>0 AND length(trim(observation_code))>0 AND length(trim(code_system))>0 AND length(trim(display_snapshot))>0),
  CHECK (value_type IN ('decimal','text','coded','boolean','date_time','absent')),
  CHECK ((value_type='decimal' AND value_decimal IS NOT NULL AND value_text IS NULL AND value_code IS NULL AND value_code_system IS NULL AND value_boolean IS NULL AND value_date_time_utc IS NULL AND unit_code IS NOT NULL) OR (value_type='text' AND value_text IS NOT NULL AND value_decimal IS NULL AND value_code IS NULL AND value_code_system IS NULL AND value_boolean IS NULL AND value_date_time_utc IS NULL) OR (value_type='coded' AND value_text IS NULL AND value_decimal IS NULL AND value_code IS NOT NULL AND value_code_system IS NOT NULL AND value_boolean IS NULL AND value_date_time_utc IS NULL) OR (value_type='boolean' AND value_text IS NULL AND value_decimal IS NULL AND value_code IS NULL AND value_code_system IS NULL AND value_boolean IN (0,1) AND value_date_time_utc IS NULL) OR (value_type='date_time' AND value_text IS NULL AND value_decimal IS NULL AND value_code IS NULL AND value_code_system IS NULL AND value_boolean IS NULL AND value_date_time_utc IS NOT NULL AND substr(value_date_time_utc,-1)='Z') OR (value_type='absent' AND value_text IS NULL AND value_decimal IS NULL AND value_code IS NULL AND value_code_system IS NULL AND value_boolean IS NULL AND value_date_time_utc IS NULL AND reason_code IS NOT NULL AND length(trim(reason_code))>0)),
  CHECK (value_decimal IS NULL OR (value_decimal=trim(value_decimal) AND length(value_decimal)>0 AND value_decimal GLOB '*[0-9]*' AND value_decimal NOT GLOB '*[^0-9.-]*' AND value_decimal NOT LIKE '.%' AND value_decimal NOT LIKE '%.' AND value_decimal NOT GLOB '*.*.*' AND value_decimal NOT GLOB '*-*-*' AND (instr(value_decimal,'-')=0 OR instr(value_decimal,'-')=1))),
  CHECK (reference_low_decimal IS NULL OR (reference_low_decimal=trim(reference_low_decimal) AND length(reference_low_decimal)>0 AND reference_low_decimal GLOB '*[0-9]*' AND reference_low_decimal NOT GLOB '*[^0-9.-]*' AND reference_low_decimal NOT LIKE '.%' AND reference_low_decimal NOT LIKE '%.' AND reference_low_decimal NOT GLOB '*.*.*' AND reference_low_decimal NOT GLOB '*-*-*' AND (instr(reference_low_decimal,'-')=0 OR instr(reference_low_decimal,'-')=1))),
  CHECK (reference_high_decimal IS NULL OR (reference_high_decimal=trim(reference_high_decimal) AND length(reference_high_decimal)>0 AND reference_high_decimal GLOB '*[0-9]*' AND reference_high_decimal NOT GLOB '*[^0-9.-]*' AND reference_high_decimal NOT LIKE '.%' AND reference_high_decimal NOT LIKE '%.' AND reference_high_decimal NOT GLOB '*.*.*' AND reference_high_decimal NOT GLOB '*-*-*' AND (instr(reference_high_decimal,'-')=0 OR instr(reference_high_decimal,'-')=1))),
  CHECK (observation_status IN ('preliminary','final','corrected','retracted','entered_in_error','absent')),
  CHECK (observation_status NOT IN ('retracted','entered_in_error','absent') OR (reason_code IS NOT NULL AND length(trim(reason_code))>0)),
  CHECK (length(source_evidence_sha256)=64 AND source_evidence_sha256=lower(source_evidence_sha256) AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (substr(created_at_utc,-1)='Z'),
  FOREIGN KEY (tenant_id,result_set_public_id,version_public_id) REFERENCES canonical_lab_result_versions(tenant_id,result_set_public_id,version_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,service_public_id) REFERENCES canonical_service_catalog_items(tenant_id,service_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,specimen_public_id) REFERENCES canonical_lab_specimens(tenant_id,specimen_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,observation_public_id),
  UNIQUE (tenant_id,result_set_public_id,version_public_id,observation_public_id),
  UNIQUE (tenant_id,result_set_public_id,version_public_id,observation_sequence)
);
CREATE INDEX IF NOT EXISTS idx_canonical_lab_observations_version ON canonical_lab_result_observations(tenant_id,result_set_public_id,version_public_id,observation_sequence);

CREATE TABLE IF NOT EXISTS canonical_lab_result_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  event_public_id TEXT NOT NULL,
  result_set_public_id TEXT NOT NULL,
  version_public_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_practitioner_public_id TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  signed_content_sha256 TEXT,
  reason_code TEXT NOT NULL,
  occurred_at_utc TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (from_status IS NULL OR from_status IN ('draft','verified','validated','published','retracted','entered_in_error')),
  CHECK (to_status IN ('draft','verified','validated','published','retracted','entered_in_error')),
  CHECK (event_version>0),
  CHECK (event_type IN ('draft_created','draft_replaced','verified','validation_failed','validated','published','corrected','retracted','entered_in_error')),
  CHECK (actor_practitioner_public_id IS NOT NULL OR actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL),
  CHECK ((event_type IN ('verified','validated','published') AND actor_practitioner_public_id IS NOT NULL AND signed_content_sha256 IS NOT NULL) OR (event_type NOT IN ('verified','validated','published') AND signed_content_sha256 IS NULL)),
  CHECK (signed_content_sha256 IS NULL OR (length(signed_content_sha256)=64 AND signed_content_sha256=lower(signed_content_sha256) AND signed_content_sha256 NOT GLOB '*[^0-9a-f]*')),
  CHECK (length(trim(reason_code))>0),
  CHECK (substr(occurred_at_utc,-1)='Z' AND substr(created_at_utc,-1)='Z'),
  CHECK (length(source_evidence_sha256)=64 AND source_evidence_sha256=lower(source_evidence_sha256) AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  FOREIGN KEY (tenant_id,result_set_public_id,version_public_id) REFERENCES canonical_lab_result_versions(tenant_id,result_set_public_id,version_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,actor_practitioner_public_id) REFERENCES canonical_practitioners(tenant_id,practitioner_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,event_public_id),
  UNIQUE (tenant_id,result_set_public_id,event_public_id),
  UNIQUE (tenant_id,result_set_public_id,event_version)
);

CREATE TABLE IF NOT EXISTS canonical_lab_analyzer_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  analyzer_evidence_public_id TEXT NOT NULL,
  result_set_public_id TEXT,
  version_public_id TEXT,
  observation_public_id TEXT,
  source_type TEXT NOT NULL,
  source_public_id TEXT NOT NULL,
  ingestion_message_public_id TEXT,
  observation_index INTEGER NOT NULL,
  machine_source_type TEXT,
  machine_source_public_id TEXT,
  bridge_source_type TEXT,
  bridge_source_public_id TEXT,
  log_source_type TEXT,
  log_source_public_id TEXT,
  protocol TEXT,
  payload_sha256 TEXT NOT NULL,
  qc_state TEXT NOT NULL,
  validation_state TEXT NOT NULL,
  match_state TEXT NOT NULL,
  disposition TEXT NOT NULL,
  conversion_factor_decimal TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  occurred_at_utc TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (observation_index>=0),
  CHECK (length(trim(source_type))>0 AND length(trim(source_public_id))>0),
  CHECK ((machine_source_type IS NULL AND machine_source_public_id IS NULL) OR (machine_source_type IS NOT NULL AND machine_source_public_id IS NOT NULL)),
  CHECK ((bridge_source_type IS NULL AND bridge_source_public_id IS NULL) OR (bridge_source_type IS NOT NULL AND bridge_source_public_id IS NOT NULL)),
  CHECK ((log_source_type IS NULL AND log_source_public_id IS NULL) OR (log_source_type IS NOT NULL AND log_source_public_id IS NOT NULL)),
  CHECK (qc_state IN ('pending','passed','failed','not_applicable') AND validation_state IN ('pending','passed','failed','overridden') AND match_state IN ('unmatched','candidate','matched','ambiguous','rejected') AND disposition IN ('staged','accepted','rejected','superseded','collision')),
  CHECK (disposition!='accepted' OR (result_set_public_id IS NOT NULL AND version_public_id IS NOT NULL AND observation_public_id IS NOT NULL AND match_state='matched' AND qc_state IN ('passed','not_applicable') AND validation_state IN ('passed','overridden'))),
  CHECK (actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL),
  CHECK (length(payload_sha256)=64 AND payload_sha256=lower(payload_sha256) AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (conversion_factor_decimal IS NULL OR (conversion_factor_decimal=trim(conversion_factor_decimal) AND length(conversion_factor_decimal)>0 AND conversion_factor_decimal GLOB '*[0-9]*' AND conversion_factor_decimal NOT GLOB '*[^0-9.-]*' AND conversion_factor_decimal NOT LIKE '.%' AND conversion_factor_decimal NOT LIKE '%.' AND conversion_factor_decimal NOT GLOB '*.*.*' AND conversion_factor_decimal NOT GLOB '*-*-*' AND (instr(conversion_factor_decimal,'-')=0 OR instr(conversion_factor_decimal,'-')=1))),
  CHECK (substr(occurred_at_utc,-1)='Z' AND substr(created_at_utc,-1)='Z'),
  CHECK (length(source_evidence_sha256)=64 AND source_evidence_sha256=lower(source_evidence_sha256) AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  FOREIGN KEY (tenant_id,result_set_public_id,version_public_id,observation_public_id) REFERENCES canonical_lab_result_observations(tenant_id,result_set_public_id,version_public_id,observation_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,analyzer_evidence_public_id),
  UNIQUE (tenant_id,source_type,source_public_id,observation_index)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_lab_analyzer_accepted_observation ON canonical_lab_analyzer_evidence(tenant_id,observation_public_id) WHERE disposition='accepted';

CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_specimen_event_state_guard BEFORE INSERT ON canonical_lab_specimen_status_events
WHEN NOT ((NEW.event_version=1 AND NEW.from_status IS NULL AND NEW.to_status='registered' AND NEW.event_type='registered' AND EXISTS (SELECT 1 FROM canonical_lab_specimens s WHERE s.tenant_id=NEW.tenant_id AND s.specimen_public_id=NEW.specimen_public_id AND s.current_status='registered' AND s.status_version=1 AND s.current_status_event_public_id IS NULL)) OR (NEW.event_version>1 AND NEW.from_status IS NOT NULL AND EXISTS (SELECT 1 FROM canonical_lab_specimens s WHERE s.tenant_id=NEW.tenant_id AND s.specimen_public_id=NEW.specimen_public_id AND s.current_status=NEW.from_status AND NEW.event_version=s.status_version+1) AND ((NEW.from_status='registered' AND NEW.to_status IN ('collected','entered_in_error')) OR (NEW.from_status='collected' AND NEW.to_status IN ('in_transit','received','rejected','disposed','entered_in_error')) OR (NEW.from_status='in_transit' AND NEW.to_status IN ('received','rejected','disposed','entered_in_error')) OR (NEW.from_status='received' AND NEW.to_status IN ('processing','rejected','disposed','entered_in_error')) OR (NEW.from_status='processing' AND NEW.to_status IN ('disposed','entered_in_error')))))
BEGIN SELECT RAISE(ABORT,'canonical lab specimen status event does not match current state or version'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_specimen_event_immutable_update BEFORE UPDATE ON canonical_lab_specimen_status_events BEGIN SELECT RAISE(ABORT,'canonical lab specimen custody history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_specimen_event_immutable_delete BEFORE DELETE ON canonical_lab_specimen_status_events BEGIN SELECT RAISE(ABORT,'canonical lab specimen custody history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_specimen_current_state_guard BEFORE UPDATE OF current_status,status_version,current_status_event_public_id ON canonical_lab_specimens
WHEN NOT ((OLD.current_status_event_public_id IS NULL AND NEW.current_status_event_public_id IS NOT NULL AND OLD.current_status='registered' AND NEW.current_status='registered' AND OLD.status_version=1 AND NEW.status_version=1 AND EXISTS (SELECT 1 FROM canonical_lab_specimen_status_events e WHERE e.tenant_id=NEW.tenant_id AND e.specimen_public_id=NEW.specimen_public_id AND e.event_public_id=NEW.current_status_event_public_id AND e.event_version=1 AND e.from_status IS NULL AND e.to_status='registered')) OR (NEW.status_version=OLD.status_version+1 AND EXISTS (SELECT 1 FROM canonical_lab_specimen_status_events e WHERE e.tenant_id=NEW.tenant_id AND e.specimen_public_id=NEW.specimen_public_id AND e.event_public_id=NEW.current_status_event_public_id AND e.event_version=NEW.status_version AND e.from_status=OLD.current_status AND e.to_status=NEW.current_status)))
BEGIN SELECT RAISE(ABORT,'canonical lab specimen current state requires matching immutable event'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_specimen_identity_immutable BEFORE UPDATE ON canonical_lab_specimens
WHEN OLD.tenant_id IS NOT NEW.tenant_id OR OLD.specimen_public_id IS NOT NEW.specimen_public_id OR OLD.patient_link_public_id IS NOT NEW.patient_link_public_id OR OLD.encounter_public_id IS NOT NEW.encounter_public_id OR OLD.primary_request_public_id IS NOT NEW.primary_request_public_id OR OLD.primary_service_public_id IS NOT NEW.primary_service_public_id OR OLD.accession_namespace IS NOT NEW.accession_namespace OR OLD.accession_value IS NOT NEW.accession_value OR OLD.barcode_namespace IS NOT NEW.barcode_namespace OR OLD.barcode_value IS NOT NEW.barcode_value OR OLD.specimen_type_code IS NOT NEW.specimen_type_code OR OLD.container_code IS NOT NEW.container_code OR OLD.parent_specimen_public_id IS NOT NEW.parent_specimen_public_id OR OLD.actor_user_public_id IS NOT NEW.actor_user_public_id OR OLD.actor_system_key IS NOT NEW.actor_system_key OR OLD.idempotency_key IS NOT NEW.idempotency_key OR OLD.request_fingerprint_sha256 IS NOT NEW.request_fingerprint_sha256 OR OLD.source_evidence_sha256 IS NOT NEW.source_evidence_sha256 OR OLD.created_at_utc IS NOT NEW.created_at_utc
BEGIN SELECT RAISE(ABORT,'canonical lab specimen identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_specimen_delete_restricted BEFORE DELETE ON canonical_lab_specimens BEGIN SELECT RAISE(ABORT,'canonical lab specimen delete is restricted'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_specimen_service_immutable_update BEFORE UPDATE ON canonical_lab_specimen_service_items BEGIN SELECT RAISE(ABORT,'canonical lab specimen service link is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_specimen_service_immutable_delete BEFORE DELETE ON canonical_lab_specimen_service_items BEGIN SELECT RAISE(ABORT,'canonical lab specimen service link is immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_result_version_sequence BEFORE INSERT ON canonical_lab_result_versions
WHEN NOT ((NEW.version_number=1 AND NOT EXISTS (SELECT 1 FROM canonical_lab_result_versions v WHERE v.tenant_id=NEW.tenant_id AND v.result_set_public_id=NEW.result_set_public_id)) OR (NEW.version_number>1 AND EXISTS (SELECT 1 FROM canonical_lab_result_versions v WHERE v.tenant_id=NEW.tenant_id AND v.result_set_public_id=NEW.result_set_public_id AND v.version_number=NEW.version_number-1)))
BEGIN SELECT RAISE(ABORT,'canonical lab result version sequence is not contiguous'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_result_version_insert_draft BEFORE INSERT ON canonical_lab_result_versions
WHEN NEW.version_status!='draft' OR NEW.signed_content_sha256 IS NOT NULL OR NEW.verifying_practitioner_public_id IS NOT NULL OR NEW.validating_practitioner_public_id IS NOT NULL OR NEW.verified_at_utc IS NOT NULL OR NEW.validated_at_utc IS NOT NULL OR NEW.published_at_utc IS NOT NULL OR NEW.retracted_at_utc IS NOT NULL
BEGIN SELECT RAISE(ABORT,'canonical lab result version must start as draft'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_result_version_content_immutable BEFORE UPDATE ON canonical_lab_result_versions
WHEN OLD.tenant_id IS NOT NEW.tenant_id OR OLD.version_public_id IS NOT NEW.version_public_id OR OLD.result_set_public_id IS NOT NEW.result_set_public_id OR OLD.version_number IS NOT NEW.version_number OR OLD.supersedes_version_public_id IS NOT NEW.supersedes_version_public_id OR OLD.version_kind IS NOT NEW.version_kind OR OLD.content_sha256 IS NOT NEW.content_sha256 OR OLD.authoring_practitioner_public_id IS NOT NEW.authoring_practitioner_public_id OR OLD.actor_user_public_id IS NOT NEW.actor_user_public_id OR OLD.actor_system_key IS NOT NEW.actor_system_key OR OLD.authored_at_utc IS NOT NEW.authored_at_utc OR OLD.reason_code IS NOT NEW.reason_code OR OLD.source_evidence_sha256 IS NOT NEW.source_evidence_sha256 OR OLD.created_at_utc IS NOT NEW.created_at_utc
BEGIN SELECT RAISE(ABORT,'canonical lab result version content is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_result_version_lifecycle_guard BEFORE UPDATE OF version_status,signed_content_sha256,verifying_practitioner_public_id,validating_practitioner_public_id,verified_at_utc,validated_at_utc,published_at_utc,retracted_at_utc ON canonical_lab_result_versions
WHEN NOT (
  (
    (OLD.version_status='draft' AND NEW.version_status='verified')
    OR (OLD.version_status='verified' AND NEW.version_status='validated')
    OR (OLD.version_status='validated' AND NEW.version_status='published')
    OR (OLD.version_status NOT IN ('retracted','entered_in_error') AND NEW.version_status IN ('retracted','entered_in_error'))
  )
  AND EXISTS (
    SELECT 1 FROM canonical_lab_result_status_events e
    WHERE e.tenant_id=NEW.tenant_id
      AND e.result_set_public_id=NEW.result_set_public_id
      AND e.version_public_id=NEW.version_public_id
      AND e.to_status=NEW.version_status
  )
  AND (
    (NEW.version_status='verified' AND NEW.signed_content_sha256=NEW.content_sha256 AND NEW.verifying_practitioner_public_id IS NOT NULL AND NEW.verified_at_utc IS NOT NULL)
    OR (NEW.version_status='validated' AND NEW.signed_content_sha256=NEW.content_sha256 AND NEW.verifying_practitioner_public_id IS NOT NULL AND NEW.verified_at_utc IS NOT NULL AND NEW.validating_practitioner_public_id IS NOT NULL AND NEW.validated_at_utc IS NOT NULL)
    OR (NEW.version_status='published' AND NEW.signed_content_sha256=NEW.content_sha256 AND NEW.verifying_practitioner_public_id IS NOT NULL AND NEW.verified_at_utc IS NOT NULL AND NEW.validating_practitioner_public_id IS NOT NULL AND NEW.validated_at_utc IS NOT NULL AND NEW.published_at_utc IS NOT NULL)
    OR (NEW.version_status='retracted' AND NEW.reason_code IS NOT NULL AND NEW.retracted_at_utc IS NOT NULL)
    OR (NEW.version_status='entered_in_error' AND NEW.reason_code IS NOT NULL)
  )
)
BEGIN SELECT RAISE(ABORT,'canonical lab result version lifecycle requires matching signed status event'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_result_version_terminal_immutable BEFORE UPDATE ON canonical_lab_result_versions WHEN OLD.version_status IN ('retracted','entered_in_error') BEGIN SELECT RAISE(ABORT,'canonical lab result version history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_result_version_immutable_delete BEFORE DELETE ON canonical_lab_result_versions BEGIN SELECT RAISE(ABORT,'canonical lab result version history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_observation_sequence BEFORE INSERT ON canonical_lab_result_observations
WHEN NEW.observation_sequence!=(SELECT COUNT(*)+1 FROM canonical_lab_result_observations o WHERE o.tenant_id=NEW.tenant_id AND o.result_set_public_id=NEW.result_set_public_id AND o.version_public_id=NEW.version_public_id)
BEGIN SELECT RAISE(ABORT,'canonical lab result observation sequence is not contiguous'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_observation_draft_insert BEFORE INSERT ON canonical_lab_result_observations
WHEN NOT EXISTS (SELECT 1 FROM canonical_lab_result_versions v WHERE v.tenant_id=NEW.tenant_id AND v.result_set_public_id=NEW.result_set_public_id AND v.version_public_id=NEW.version_public_id AND v.version_status='draft')
BEGIN SELECT RAISE(ABORT,'canonical lab result observations require a draft version'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_observation_immutable_update BEFORE UPDATE ON canonical_lab_result_observations BEGIN SELECT RAISE(ABORT,'canonical lab result observation history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_observation_immutable_delete BEFORE DELETE ON canonical_lab_result_observations BEGIN SELECT RAISE(ABORT,'canonical lab result observation history is immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_result_event_state_guard BEFORE INSERT ON canonical_lab_result_status_events
WHEN NOT (
  (
    NEW.event_version=1
    AND NEW.from_status IS NULL
    AND NEW.to_status='draft'
    AND NEW.event_type='draft_created'
    AND EXISTS (
      SELECT 1 FROM canonical_lab_result_sets r
      WHERE r.tenant_id=NEW.tenant_id
        AND r.result_set_public_id=NEW.result_set_public_id
        AND r.current_status='draft'
        AND r.status_version=1
        AND r.current_status_event_public_id IS NULL
    )
  )
  OR (
    NEW.event_version>1
    AND NEW.from_status IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM canonical_lab_result_sets r
      WHERE r.tenant_id=NEW.tenant_id
        AND r.result_set_public_id=NEW.result_set_public_id
        AND r.current_status=NEW.from_status
        AND NEW.event_version=r.status_version+1
        AND (
          (
            r.current_version_public_id=NEW.version_public_id
            AND (
              (NEW.from_status='draft' AND NEW.to_status IN ('verified','retracted','entered_in_error'))
              OR (NEW.from_status='verified' AND NEW.to_status IN ('validated','retracted','entered_in_error'))
              OR (NEW.from_status='validated' AND NEW.to_status IN ('published','retracted','entered_in_error'))
              OR (NEW.from_status='published' AND NEW.to_status IN ('retracted','entered_in_error'))
            )
          )
          OR (
            EXISTS (
              SELECT 1 FROM canonical_lab_result_versions v
              WHERE v.tenant_id=NEW.tenant_id
                AND v.result_set_public_id=NEW.result_set_public_id
                AND v.version_public_id=NEW.version_public_id
                AND v.supersedes_version_public_id=r.current_version_public_id
                AND v.version_status='draft'
            )
            AND (
              (NEW.event_type='draft_replaced' AND NEW.from_status='draft' AND NEW.to_status='draft')
              OR (NEW.event_type='corrected' AND NEW.from_status IN ('draft','verified','validated','published') AND NEW.to_status='draft')
              OR (NEW.event_type='retracted' AND NEW.from_status IN ('draft','verified','validated','published') AND NEW.to_status='retracted')
              OR (NEW.event_type='entered_in_error' AND NEW.from_status IN ('draft','verified','validated','published') AND NEW.to_status='entered_in_error')
            )
          )
        )
    )
  )
)
BEGIN SELECT RAISE(ABORT,'canonical lab result status event does not match current state or version'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_result_event_signature_guard BEFORE INSERT ON canonical_lab_result_status_events
WHEN NEW.event_type IN ('verified','validated','published') AND NOT EXISTS (SELECT 1 FROM canonical_lab_result_versions v WHERE v.tenant_id=NEW.tenant_id AND v.result_set_public_id=NEW.result_set_public_id AND v.version_public_id=NEW.version_public_id AND NEW.signed_content_sha256=v.content_sha256)
BEGIN SELECT RAISE(ABORT,'canonical lab result signed content does not match version content'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_result_event_immutable_update BEFORE UPDATE ON canonical_lab_result_status_events BEGIN SELECT RAISE(ABORT,'canonical lab result status history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_result_event_immutable_delete BEFORE DELETE ON canonical_lab_result_status_events BEGIN SELECT RAISE(ABORT,'canonical lab result status history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_result_set_current_guard BEFORE UPDATE OF current_version_public_id,current_status,status_version,current_status_event_public_id ON canonical_lab_result_sets
WHEN NOT ((OLD.current_version_public_id IS NULL AND NEW.current_version_public_id IS NOT NULL AND OLD.current_status='draft' AND NEW.current_status='draft' AND OLD.status_version=1 AND NEW.status_version=1 AND EXISTS (SELECT 1 FROM canonical_lab_result_versions v JOIN canonical_lab_result_status_events e ON e.tenant_id=v.tenant_id AND e.result_set_public_id=v.result_set_public_id AND e.version_public_id=v.version_public_id WHERE v.tenant_id=NEW.tenant_id AND v.result_set_public_id=NEW.result_set_public_id AND v.version_public_id=NEW.current_version_public_id AND v.version_status='draft' AND e.event_version=1 AND e.from_status IS NULL AND e.to_status='draft' AND e.event_type='draft_created')) OR (NEW.status_version=OLD.status_version+1 AND NEW.current_version_public_id IS NOT NULL AND NEW.current_status_event_public_id IS NOT NULL AND EXISTS (SELECT 1 FROM canonical_lab_result_status_events e JOIN canonical_lab_result_versions v ON v.tenant_id=e.tenant_id AND v.result_set_public_id=e.result_set_public_id AND v.version_public_id=e.version_public_id WHERE e.tenant_id=NEW.tenant_id AND e.result_set_public_id=NEW.result_set_public_id AND e.event_public_id=NEW.current_status_event_public_id AND e.event_version=NEW.status_version AND e.from_status=OLD.current_status AND e.to_status=NEW.current_status AND e.version_public_id=NEW.current_version_public_id AND v.version_status=NEW.current_status)))
BEGIN SELECT RAISE(ABORT,'canonical lab result current state requires matching version and status event'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_result_set_identity_immutable BEFORE UPDATE ON canonical_lab_result_sets
WHEN OLD.tenant_id IS NOT NEW.tenant_id OR OLD.result_set_public_id IS NOT NEW.result_set_public_id OR OLD.patient_link_public_id IS NOT NEW.patient_link_public_id OR OLD.encounter_public_id IS NOT NEW.encounter_public_id OR OLD.request_public_id IS NOT NEW.request_public_id OR OLD.event_public_id IS NOT NEW.event_public_id OR OLD.specimen_public_id IS NOT NEW.specimen_public_id OR OLD.service_public_id IS NOT NEW.service_public_id OR OLD.creating_practitioner_public_id IS NOT NEW.creating_practitioner_public_id OR OLD.actor_user_public_id IS NOT NEW.actor_user_public_id OR OLD.actor_system_key IS NOT NEW.actor_system_key OR OLD.idempotency_key IS NOT NEW.idempotency_key OR OLD.request_fingerprint_sha256 IS NOT NEW.request_fingerprint_sha256 OR OLD.source_evidence_sha256 IS NOT NEW.source_evidence_sha256 OR OLD.created_at_utc IS NOT NEW.created_at_utc
BEGIN SELECT RAISE(ABORT,'canonical lab result set identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_result_set_delete_restricted BEFORE DELETE ON canonical_lab_result_sets BEGIN SELECT RAISE(ABORT,'canonical lab result set delete is restricted'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_analyzer_immutable_update BEFORE UPDATE ON canonical_lab_analyzer_evidence BEGIN SELECT RAISE(ABORT,'canonical lab analyzer evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_lab_analyzer_immutable_delete BEFORE DELETE ON canonical_lab_analyzer_evidence BEGIN SELECT RAISE(ABORT,'canonical lab analyzer evidence is immutable'); END;
