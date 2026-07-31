-- =============================================================================
-- HMS Canonical Radiology Acquisition, DICOM Hierarchy, Provenance, and Report
-- Additive-only authority. Existing RIS/PACS/report/billing sources remain active
-- compatibility sources until separately authorised cutover.
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_encounters_imaging_patient_scope
  ON canonical_encounters(tenant_id, encounter_public_id, patient_link_public_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_service_requests_imaging_scope
  ON canonical_service_requests(tenant_id, request_public_id, encounter_public_id, service_public_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_service_events_imaging_scope
  ON canonical_service_events(tenant_id, event_public_id, request_public_id, encounter_public_id, service_public_id);

CREATE TABLE IF NOT EXISTS canonical_imaging_acquisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  acquisition_public_id TEXT NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  request_public_id TEXT NOT NULL,
  event_public_id TEXT,
  service_public_id TEXT NOT NULL,
  accession_namespace TEXT NOT NULL,
  accession_value TEXT NOT NULL,
  modality_code TEXT NOT NULL,
  body_site_code TEXT,
  procedure_snapshot TEXT,
  current_status TEXT NOT NULL DEFAULT 'scheduled',
  status_version INTEGER NOT NULL DEFAULT 1,
  current_status_event_public_id TEXT,
  scheduled_at_utc TEXT,
  started_at_utc TEXT,
  completed_at_utc TEXT,
  cancelled_at_utc TEXT,
  entered_in_error_at_utc TEXT,
  performing_practitioner_public_id TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  idempotency_key TEXT NOT NULL,
  request_fingerprint_sha256 TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (current_status IN ('scheduled','ready','in_progress','completed','cancelled','entered_in_error')),
  CHECK (status_version > 0),
  CHECK (length(trim(accession_namespace)) > 0 AND length(trim(accession_value)) > 0),
  CHECK (length(trim(modality_code)) > 0),
  CHECK (actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL),
  CHECK (
    (scheduled_at_utc IS NULL OR substr(scheduled_at_utc,-1)='Z')
    AND (started_at_utc IS NULL OR substr(started_at_utc,-1)='Z')
    AND (completed_at_utc IS NULL OR substr(completed_at_utc,-1)='Z')
    AND (cancelled_at_utc IS NULL OR substr(cancelled_at_utc,-1)='Z')
    AND (entered_in_error_at_utc IS NULL OR substr(entered_in_error_at_utc,-1)='Z')
    AND substr(created_at_utc,-1)='Z' AND substr(updated_at_utc,-1)='Z'
  ),
  CHECK (length(request_fingerprint_sha256)=64 AND request_fingerprint_sha256=lower(request_fingerprint_sha256) AND request_fingerprint_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(source_evidence_sha256)=64 AND source_evidence_sha256=lower(source_evidence_sha256) AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  FOREIGN KEY (tenant_id,patient_link_public_id)
    REFERENCES canonical_tenant_patient_links(tenant_id,patient_link_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,encounter_public_id,patient_link_public_id)
    REFERENCES canonical_encounters(tenant_id,encounter_public_id,patient_link_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,request_public_id,encounter_public_id,service_public_id)
    REFERENCES canonical_service_requests(tenant_id,request_public_id,encounter_public_id,service_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,event_public_id,request_public_id,encounter_public_id,service_public_id)
    REFERENCES canonical_service_events(tenant_id,event_public_id,request_public_id,encounter_public_id,service_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,service_public_id)
    REFERENCES canonical_service_catalog_items(tenant_id,service_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,performing_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id,practitioner_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,acquisition_public_id,current_status_event_public_id)
    REFERENCES canonical_imaging_acquisition_status_events(tenant_id,acquisition_public_id,event_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,acquisition_public_id),
  UNIQUE (tenant_id,acquisition_public_id,patient_link_public_id,encounter_public_id,request_public_id,service_public_id),
  UNIQUE (tenant_id,accession_namespace,accession_value),
  UNIQUE (tenant_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_canonical_imaging_acquisitions_patient_status
  ON canonical_imaging_acquisitions(tenant_id,patient_link_public_id,current_status,acquisition_public_id);
CREATE INDEX IF NOT EXISTS idx_canonical_imaging_acquisitions_request_status
  ON canonical_imaging_acquisitions(tenant_id,request_public_id,current_status,acquisition_public_id);

CREATE TABLE IF NOT EXISTS canonical_imaging_acquisition_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  event_public_id TEXT NOT NULL,
  acquisition_public_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_practitioner_public_id TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  modality_source_type TEXT,
  modality_source_public_id TEXT,
  pacs_endpoint_source_type TEXT,
  pacs_endpoint_source_public_id TEXT,
  occurred_at_utc TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (from_status IS NULL OR from_status IN ('scheduled','ready','in_progress','completed','cancelled','entered_in_error')),
  CHECK (to_status IN ('scheduled','ready','in_progress','completed','cancelled','entered_in_error')),
  CHECK (event_version > 0),
  CHECK (event_type IN ('registered','ready','started','completed','cancelled','corrected','entered_in_error')),
  CHECK (actor_practitioner_public_id IS NOT NULL OR actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL),
  CHECK (event_type!='completed' OR actor_practitioner_public_id IS NOT NULL),
  CHECK ((modality_source_type IS NULL AND modality_source_public_id IS NULL) OR (modality_source_type IS NOT NULL AND modality_source_public_id IS NOT NULL)),
  CHECK ((pacs_endpoint_source_type IS NULL AND pacs_endpoint_source_public_id IS NULL) OR (pacs_endpoint_source_type IS NOT NULL AND pacs_endpoint_source_public_id IS NOT NULL)),
  CHECK (length(trim(reason_code)) > 0),
  CHECK (substr(occurred_at_utc,-1)='Z' AND substr(recorded_at_utc,-1)='Z' AND recorded_at_utc>=occurred_at_utc AND substr(created_at_utc,-1)='Z'),
  CHECK (length(source_evidence_sha256)=64 AND source_evidence_sha256=lower(source_evidence_sha256) AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  FOREIGN KEY (tenant_id,acquisition_public_id)
    REFERENCES canonical_imaging_acquisitions(tenant_id,acquisition_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,actor_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id,practitioner_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,event_public_id),
  UNIQUE (tenant_id,acquisition_public_id,event_public_id),
  UNIQUE (tenant_id,acquisition_public_id,event_version)
);
CREATE INDEX IF NOT EXISTS idx_canonical_imaging_acquisition_events_timeline
  ON canonical_imaging_acquisition_status_events(tenant_id,acquisition_public_id,event_version,occurred_at_utc);

CREATE TABLE IF NOT EXISTS canonical_imaging_studies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  study_public_id TEXT NOT NULL,
  acquisition_public_id TEXT NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  request_public_id TEXT NOT NULL,
  service_public_id TEXT NOT NULL,
  study_uid_namespace TEXT NOT NULL,
  study_instance_uid TEXT NOT NULL,
  accession_namespace TEXT NOT NULL,
  accession_value TEXT NOT NULL,
  modality_code TEXT NOT NULL,
  study_started_at_utc TEXT NOT NULL,
  current_status TEXT NOT NULL DEFAULT 'active',
  status_version INTEGER NOT NULL DEFAULT 1,
  current_provenance_event_public_id TEXT,
  series_count INTEGER NOT NULL DEFAULT 0,
  instance_count INTEGER NOT NULL DEFAULT 0,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  idempotency_key TEXT NOT NULL,
  request_fingerprint_sha256 TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (current_status IN ('active','completed','retracted','entered_in_error')),
  CHECK (status_version > 0 AND series_count >= 0 AND instance_count >= 0),
  CHECK (length(trim(study_uid_namespace)) > 0 AND length(trim(study_instance_uid)) > 0),
  CHECK (length(trim(accession_namespace)) > 0 AND length(trim(accession_value)) > 0),
  CHECK (length(trim(modality_code)) > 0),
  CHECK (actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL),
  CHECK (substr(study_started_at_utc,-1)='Z' AND substr(created_at_utc,-1)='Z' AND substr(updated_at_utc,-1)='Z'),
  CHECK (length(request_fingerprint_sha256)=64 AND request_fingerprint_sha256=lower(request_fingerprint_sha256) AND request_fingerprint_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(source_evidence_sha256)=64 AND source_evidence_sha256=lower(source_evidence_sha256) AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  FOREIGN KEY (tenant_id,acquisition_public_id,patient_link_public_id,encounter_public_id,request_public_id,service_public_id)
    REFERENCES canonical_imaging_acquisitions(tenant_id,acquisition_public_id,patient_link_public_id,encounter_public_id,request_public_id,service_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,study_public_id,current_provenance_event_public_id)
    REFERENCES canonical_imaging_provenance_events(tenant_id,study_public_id,provenance_event_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,study_public_id),
  UNIQUE (tenant_id,study_public_id,acquisition_public_id,patient_link_public_id,encounter_public_id,request_public_id,service_public_id),
  UNIQUE (tenant_id,study_uid_namespace,study_instance_uid),
  UNIQUE (tenant_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_canonical_imaging_studies_acquisition
  ON canonical_imaging_studies(tenant_id,acquisition_public_id,current_status,study_public_id);
CREATE INDEX IF NOT EXISTS idx_canonical_imaging_studies_uid
  ON canonical_imaging_studies(tenant_id,study_uid_namespace,study_instance_uid);

CREATE TABLE IF NOT EXISTS canonical_imaging_series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  series_public_id TEXT NOT NULL,
  study_public_id TEXT NOT NULL,
  series_uid_namespace TEXT NOT NULL,
  series_instance_uid TEXT NOT NULL,
  series_number INTEGER,
  modality_code TEXT NOT NULL,
  body_part_code TEXT,
  protocol_name TEXT,
  laterality_code TEXT,
  description_snapshot TEXT,
  current_status TEXT NOT NULL DEFAULT 'active',
  instance_count INTEGER NOT NULL DEFAULT 0,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (current_status IN ('active','completed','retracted','entered_in_error')),
  CHECK (series_number IS NULL OR series_number >= 0),
  CHECK (instance_count >= 0),
  CHECK (length(trim(series_uid_namespace)) > 0 AND length(trim(series_instance_uid)) > 0),
  CHECK (length(trim(modality_code)) > 0),
  CHECK (substr(created_at_utc,-1)='Z' AND substr(updated_at_utc,-1)='Z'),
  CHECK (length(source_evidence_sha256)=64 AND source_evidence_sha256=lower(source_evidence_sha256) AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  FOREIGN KEY (tenant_id,study_public_id)
    REFERENCES canonical_imaging_studies(tenant_id,study_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,series_public_id),
  UNIQUE (tenant_id,study_public_id,series_public_id),
  UNIQUE (tenant_id,series_uid_namespace,series_instance_uid)
);
CREATE INDEX IF NOT EXISTS idx_canonical_imaging_series_study
  ON canonical_imaging_series(tenant_id,study_public_id,current_status,series_public_id);

CREATE TABLE IF NOT EXISTS canonical_imaging_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  instance_public_id TEXT NOT NULL,
  study_public_id TEXT NOT NULL,
  series_public_id TEXT NOT NULL,
  sop_uid_namespace TEXT NOT NULL,
  sop_instance_uid TEXT NOT NULL,
  sop_class_uid TEXT NOT NULL,
  instance_number INTEGER,
  frame_count INTEGER NOT NULL DEFAULT 1,
  transfer_syntax_uid TEXT,
  object_content_sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  storage_provider_type TEXT NOT NULL,
  storage_provider_public_id TEXT NOT NULL,
  storage_object_key TEXT NOT NULL,
  storage_generation TEXT NOT NULL,
  current_disposition TEXT NOT NULL DEFAULT 'accepted',
  replaces_instance_public_id TEXT,
  reason_code TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (instance_number IS NULL OR instance_number >= 0),
  CHECK (frame_count > 0 AND byte_size >= 0),
  CHECK (length(trim(sop_uid_namespace)) > 0 AND length(trim(sop_instance_uid)) > 0 AND length(trim(sop_class_uid)) > 0),
  CHECK (length(trim(storage_provider_type)) > 0 AND length(trim(storage_provider_public_id)) > 0 AND length(trim(storage_object_key)) > 0 AND length(trim(storage_generation)) > 0),
  CHECK (current_disposition IN ('staged','accepted','duplicate','replaced','rejected','collision','retracted','entered_in_error')),
  CHECK (replaces_instance_public_id IS NULL OR replaces_instance_public_id != instance_public_id),
  CHECK (current_disposition NOT IN ('replaced','retracted','entered_in_error') OR (reason_code IS NOT NULL AND length(trim(reason_code))>0)),
  CHECK (length(object_content_sha256)=64 AND object_content_sha256=lower(object_content_sha256) AND object_content_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(source_evidence_sha256)=64 AND source_evidence_sha256=lower(source_evidence_sha256) AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (substr(created_at_utc,-1)='Z'),
  FOREIGN KEY (tenant_id,study_public_id,series_public_id)
    REFERENCES canonical_imaging_series(tenant_id,study_public_id,series_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,replaces_instance_public_id)
    REFERENCES canonical_imaging_instances(tenant_id,instance_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,instance_public_id),
  UNIQUE (tenant_id,study_public_id,series_public_id,instance_public_id),
  UNIQUE (tenant_id,sop_uid_namespace,sop_instance_uid)
);
CREATE INDEX IF NOT EXISTS idx_canonical_imaging_instances_series
  ON canonical_imaging_instances(tenant_id,study_public_id,series_public_id,instance_number,instance_public_id);
CREATE INDEX IF NOT EXISTS idx_canonical_imaging_instances_storage
  ON canonical_imaging_instances(tenant_id,storage_provider_type,storage_provider_public_id,storage_object_key,storage_generation);

CREATE TABLE IF NOT EXISTS canonical_imaging_provenance_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  provenance_event_public_id TEXT NOT NULL,
  acquisition_public_id TEXT,
  study_public_id TEXT,
  series_public_id TEXT,
  instance_public_id TEXT,
  event_type TEXT NOT NULL,
  disposition TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  modality_source_type TEXT,
  modality_source_public_id TEXT,
  source_ae_title TEXT,
  called_ae_title TEXT,
  pacs_endpoint_source_type TEXT,
  pacs_endpoint_source_public_id TEXT,
  bridge_source_type TEXT,
  bridge_source_public_id TEXT,
  message_source_type TEXT,
  message_source_public_id TEXT,
  protocol TEXT,
  transfer_syntax_uid TEXT,
  object_content_sha256 TEXT,
  storage_provider_type TEXT,
  storage_provider_public_id TEXT,
  storage_object_key TEXT,
  storage_generation TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  occurred_at_utc TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (event_type IN ('worklist_sent','acquisition_started','acquisition_completed','dicom_received','instance_staged','instance_accepted','duplicate_detected','collision_detected','mapped','stored','storage_verified','replaced','retracted','entered_in_error')),
  CHECK (disposition IN ('staged','accepted','duplicate','replaced','rejected','collision','retracted','entered_in_error')),
  CHECK (event_version > 0),
  CHECK ((modality_source_type IS NULL AND modality_source_public_id IS NULL) OR (modality_source_type IS NOT NULL AND modality_source_public_id IS NOT NULL)),
  CHECK ((pacs_endpoint_source_type IS NULL AND pacs_endpoint_source_public_id IS NULL) OR (pacs_endpoint_source_type IS NOT NULL AND pacs_endpoint_source_public_id IS NOT NULL)),
  CHECK ((bridge_source_type IS NULL AND bridge_source_public_id IS NULL) OR (bridge_source_type IS NOT NULL AND bridge_source_public_id IS NOT NULL)),
  CHECK ((message_source_type IS NULL AND message_source_public_id IS NULL) OR (message_source_type IS NOT NULL AND message_source_public_id IS NOT NULL)),
  CHECK ((storage_provider_type IS NULL AND storage_provider_public_id IS NULL AND storage_object_key IS NULL AND storage_generation IS NULL) OR (storage_provider_type IS NOT NULL AND storage_provider_public_id IS NOT NULL AND storage_object_key IS NOT NULL AND storage_generation IS NOT NULL)),
  CHECK (actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL),
  CHECK (length(trim(reason_code)) > 0),
  CHECK (object_content_sha256 IS NULL OR (length(object_content_sha256)=64 AND object_content_sha256=lower(object_content_sha256) AND object_content_sha256 NOT GLOB '*[^0-9a-f]*')),
  CHECK (substr(occurred_at_utc,-1)='Z' AND substr(recorded_at_utc,-1)='Z' AND recorded_at_utc>=occurred_at_utc AND substr(created_at_utc,-1)='Z'),
  CHECK (length(source_evidence_sha256)=64 AND source_evidence_sha256=lower(source_evidence_sha256) AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  FOREIGN KEY (tenant_id,acquisition_public_id)
    REFERENCES canonical_imaging_acquisitions(tenant_id,acquisition_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,study_public_id)
    REFERENCES canonical_imaging_studies(tenant_id,study_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,study_public_id,series_public_id)
    REFERENCES canonical_imaging_series(tenant_id,study_public_id,series_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,study_public_id,series_public_id,instance_public_id)
    REFERENCES canonical_imaging_instances(tenant_id,study_public_id,series_public_id,instance_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,provenance_event_public_id),
  UNIQUE (tenant_id,study_public_id,provenance_event_public_id),
  UNIQUE (tenant_id,instance_public_id,object_content_sha256,disposition)
);
CREATE INDEX IF NOT EXISTS idx_canonical_imaging_provenance_scope
  ON canonical_imaging_provenance_events(tenant_id,acquisition_public_id,study_public_id,series_public_id,instance_public_id,event_version);
CREATE INDEX IF NOT EXISTS idx_canonical_imaging_provenance_source
  ON canonical_imaging_provenance_events(tenant_id,message_source_type,message_source_public_id,event_type);

CREATE TABLE IF NOT EXISTS canonical_imaging_report_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  report_set_public_id TEXT NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  request_public_id TEXT NOT NULL,
  service_public_id TEXT NOT NULL,
  acquisition_public_id TEXT NOT NULL,
  study_public_id TEXT NOT NULL,
  current_version_public_id TEXT,
  current_status TEXT NOT NULL DEFAULT 'draft',
  status_version INTEGER NOT NULL DEFAULT 1,
  current_status_event_public_id TEXT,
  reporting_practitioner_public_id TEXT NOT NULL,
  report_number_namespace TEXT NOT NULL,
  report_number_value TEXT NOT NULL,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  idempotency_key TEXT NOT NULL,
  request_fingerprint_sha256 TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (current_status IN ('draft','verified','final','published','retracted','entered_in_error')),
  CHECK (status_version > 0),
  CHECK (length(trim(report_number_namespace)) > 0 AND length(trim(report_number_value)) > 0),
  CHECK (actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL),
  CHECK (length(request_fingerprint_sha256)=64 AND request_fingerprint_sha256=lower(request_fingerprint_sha256) AND request_fingerprint_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(source_evidence_sha256)=64 AND source_evidence_sha256=lower(source_evidence_sha256) AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (substr(created_at_utc,-1)='Z' AND substr(updated_at_utc,-1)='Z'),
  FOREIGN KEY (tenant_id,acquisition_public_id,patient_link_public_id,encounter_public_id,request_public_id,service_public_id)
    REFERENCES canonical_imaging_acquisitions(tenant_id,acquisition_public_id,patient_link_public_id,encounter_public_id,request_public_id,service_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,study_public_id,acquisition_public_id,patient_link_public_id,encounter_public_id,request_public_id,service_public_id)
    REFERENCES canonical_imaging_studies(tenant_id,study_public_id,acquisition_public_id,patient_link_public_id,encounter_public_id,request_public_id,service_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,reporting_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id,practitioner_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,report_set_public_id,current_version_public_id)
    REFERENCES canonical_imaging_report_versions(tenant_id,report_set_public_id,version_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,report_set_public_id,current_status_event_public_id)
    REFERENCES canonical_imaging_report_status_events(tenant_id,report_set_public_id,event_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,report_set_public_id),
  UNIQUE (tenant_id,report_set_public_id,patient_link_public_id,encounter_public_id,request_public_id,service_public_id,acquisition_public_id,study_public_id),
  UNIQUE (tenant_id,report_number_namespace,report_number_value),
  UNIQUE (tenant_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_canonical_imaging_report_sets_patient_status
  ON canonical_imaging_report_sets(tenant_id,patient_link_public_id,current_status,report_set_public_id);
CREATE INDEX IF NOT EXISTS idx_canonical_imaging_report_sets_study_status
  ON canonical_imaging_report_sets(tenant_id,study_public_id,current_status,report_set_public_id);

CREATE TABLE IF NOT EXISTS canonical_imaging_report_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  version_public_id TEXT NOT NULL,
  report_set_public_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  supersedes_version_public_id TEXT,
  version_kind TEXT NOT NULL,
  version_status TEXT NOT NULL DEFAULT 'draft',
  content_json TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  signed_content_sha256 TEXT,
  authoring_practitioner_public_id TEXT NOT NULL,
  verifying_practitioner_public_id TEXT,
  finalising_practitioner_public_id TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  authored_at_utc TEXT NOT NULL,
  verified_at_utc TEXT,
  finalised_at_utc TEXT,
  published_at_utc TEXT,
  retracted_at_utc TEXT,
  reason_code TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (version_number > 0),
  CHECK (version_kind IN ('draft','amendment','correction','retraction','entered_in_error')),
  CHECK (version_status IN ('draft','verified','final','published','retracted','entered_in_error')),
  CHECK (length(trim(content_json)) > 1 AND json_valid(content_json)),
  CHECK ((version_kind='draft' AND supersedes_version_public_id IS NULL) OR (version_kind IN ('amendment','correction','retraction','entered_in_error') AND supersedes_version_public_id IS NOT NULL AND supersedes_version_public_id!=version_public_id)),
  CHECK (actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL),
  CHECK ((version_status='draft' AND signed_content_sha256 IS NULL AND verifying_practitioner_public_id IS NULL AND finalising_practitioner_public_id IS NULL AND verified_at_utc IS NULL AND finalised_at_utc IS NULL AND published_at_utc IS NULL AND retracted_at_utc IS NULL) OR (version_status IN ('verified','final','published') AND signed_content_sha256=content_sha256) OR version_status IN ('retracted','entered_in_error')),
  CHECK (length(content_sha256)=64 AND content_sha256=lower(content_sha256) AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (signed_content_sha256 IS NULL OR (length(signed_content_sha256)=64 AND signed_content_sha256=lower(signed_content_sha256) AND signed_content_sha256 NOT GLOB '*[^0-9a-f]*')),
  CHECK (version_kind NOT IN ('amendment','correction','retraction','entered_in_error') OR (reason_code IS NOT NULL AND length(trim(reason_code))>0)),
  CHECK (substr(authored_at_utc,-1)='Z' AND (verified_at_utc IS NULL OR substr(verified_at_utc,-1)='Z') AND (finalised_at_utc IS NULL OR substr(finalised_at_utc,-1)='Z') AND (published_at_utc IS NULL OR substr(published_at_utc,-1)='Z') AND (retracted_at_utc IS NULL OR substr(retracted_at_utc,-1)='Z') AND substr(created_at_utc,-1)='Z'),
  CHECK (length(source_evidence_sha256)=64 AND source_evidence_sha256=lower(source_evidence_sha256) AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  FOREIGN KEY (tenant_id,report_set_public_id)
    REFERENCES canonical_imaging_report_sets(tenant_id,report_set_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,report_set_public_id,supersedes_version_public_id)
    REFERENCES canonical_imaging_report_versions(tenant_id,report_set_public_id,version_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,authoring_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id,practitioner_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,verifying_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id,practitioner_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,finalising_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id,practitioner_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,version_public_id),
  UNIQUE (tenant_id,report_set_public_id,version_public_id),
  UNIQUE (tenant_id,report_set_public_id,version_number),
  UNIQUE (tenant_id,report_set_public_id,supersedes_version_public_id)
);
CREATE INDEX IF NOT EXISTS idx_canonical_imaging_report_versions_timeline
  ON canonical_imaging_report_versions(tenant_id,report_set_public_id,version_number,version_public_id);

CREATE TABLE IF NOT EXISTS canonical_imaging_report_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  event_public_id TEXT NOT NULL,
  report_set_public_id TEXT NOT NULL,
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
  CHECK (from_status IS NULL OR from_status IN ('draft','verified','final','published','retracted','entered_in_error')),
  CHECK (to_status IN ('draft','verified','final','published','retracted','entered_in_error')),
  CHECK (event_version > 0),
  CHECK (event_type IN ('draft_created','draft_replaced','verified','finalised','published','corrected','retracted','entered_in_error')),
  CHECK (actor_practitioner_public_id IS NOT NULL OR actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL),
  CHECK ((event_type IN ('verified','finalised','published') AND actor_practitioner_public_id IS NOT NULL AND signed_content_sha256 IS NOT NULL) OR (event_type NOT IN ('verified','finalised','published') AND signed_content_sha256 IS NULL)),
  CHECK (signed_content_sha256 IS NULL OR (length(signed_content_sha256)=64 AND signed_content_sha256=lower(signed_content_sha256) AND signed_content_sha256 NOT GLOB '*[^0-9a-f]*')),
  CHECK (length(trim(reason_code)) > 0),
  CHECK (substr(occurred_at_utc,-1)='Z' AND substr(created_at_utc,-1)='Z'),
  CHECK (length(source_evidence_sha256)=64 AND source_evidence_sha256=lower(source_evidence_sha256) AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  FOREIGN KEY (tenant_id,report_set_public_id,version_public_id)
    REFERENCES canonical_imaging_report_versions(tenant_id,report_set_public_id,version_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,actor_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id,practitioner_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,event_public_id),
  UNIQUE (tenant_id,report_set_public_id,event_public_id),
  UNIQUE (tenant_id,report_set_public_id,event_version)
);
CREATE INDEX IF NOT EXISTS idx_canonical_imaging_report_events_timeline
  ON canonical_imaging_report_status_events(tenant_id,report_set_public_id,event_version,occurred_at_utc);

-- Acquisition lifecycle guards -------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_acq_event_state_guard
BEFORE INSERT ON canonical_imaging_acquisition_status_events
WHEN NOT (
  (
    NEW.event_version=1 AND NEW.from_status IS NULL AND NEW.to_status='scheduled'
    AND NEW.event_type='registered'
    AND EXISTS (
      SELECT 1 FROM canonical_imaging_acquisitions a
      WHERE a.tenant_id=NEW.tenant_id AND a.acquisition_public_id=NEW.acquisition_public_id
        AND a.current_status='scheduled' AND a.status_version=1
        AND a.current_status_event_public_id IS NULL
    )
  )
  OR (
    NEW.event_version>1 AND NEW.from_status IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM canonical_imaging_acquisitions a
      WHERE a.tenant_id=NEW.tenant_id AND a.acquisition_public_id=NEW.acquisition_public_id
        AND a.current_status=NEW.from_status AND NEW.event_version=a.status_version+1
    )
    AND (
      (NEW.from_status='scheduled' AND NEW.to_status IN ('ready','in_progress','cancelled','entered_in_error'))
      OR (NEW.from_status='ready' AND NEW.to_status IN ('in_progress','cancelled','entered_in_error'))
      OR (NEW.from_status='in_progress' AND NEW.to_status IN ('completed','cancelled','entered_in_error'))
      OR (NEW.from_status='completed' AND NEW.to_status='entered_in_error')
    )
  )
)
BEGIN SELECT RAISE(ABORT,'canonical imaging acquisition event does not match current state or version'); END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_acq_event_immutable_update
BEFORE UPDATE ON canonical_imaging_acquisition_status_events
BEGIN SELECT RAISE(ABORT,'canonical imaging acquisition history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_acq_event_immutable_delete
BEFORE DELETE ON canonical_imaging_acquisition_status_events
BEGIN SELECT RAISE(ABORT,'canonical imaging acquisition history is immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_acq_current_guard
BEFORE UPDATE OF current_status,status_version,current_status_event_public_id ON canonical_imaging_acquisitions
WHEN NOT (
  (
    OLD.current_status_event_public_id IS NULL AND NEW.current_status_event_public_id IS NOT NULL
    AND OLD.current_status='scheduled' AND NEW.current_status='scheduled'
    AND OLD.status_version=1 AND NEW.status_version=1
    AND EXISTS (
      SELECT 1 FROM canonical_imaging_acquisition_status_events e
      WHERE e.tenant_id=NEW.tenant_id AND e.acquisition_public_id=NEW.acquisition_public_id
        AND e.event_public_id=NEW.current_status_event_public_id AND e.event_version=1
        AND e.from_status IS NULL AND e.to_status='scheduled'
    )
  )
  OR (
    NEW.status_version=OLD.status_version+1
    AND EXISTS (
      SELECT 1 FROM canonical_imaging_acquisition_status_events e
      WHERE e.tenant_id=NEW.tenant_id AND e.acquisition_public_id=NEW.acquisition_public_id
        AND e.event_public_id=NEW.current_status_event_public_id
        AND e.event_version=NEW.status_version
        AND e.from_status=OLD.current_status AND e.to_status=NEW.current_status
    )
  )
)
BEGIN SELECT RAISE(ABORT,'canonical imaging acquisition current state requires matching immutable event'); END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_acq_identity_immutable
BEFORE UPDATE ON canonical_imaging_acquisitions
WHEN OLD.tenant_id IS NOT NEW.tenant_id
  OR OLD.acquisition_public_id IS NOT NEW.acquisition_public_id
  OR OLD.patient_link_public_id IS NOT NEW.patient_link_public_id
  OR OLD.encounter_public_id IS NOT NEW.encounter_public_id
  OR OLD.request_public_id IS NOT NEW.request_public_id
  OR OLD.event_public_id IS NOT NEW.event_public_id
  OR OLD.service_public_id IS NOT NEW.service_public_id
  OR OLD.accession_namespace IS NOT NEW.accession_namespace
  OR OLD.accession_value IS NOT NEW.accession_value
  OR OLD.modality_code IS NOT NEW.modality_code
  OR OLD.performing_practitioner_public_id IS NOT NEW.performing_practitioner_public_id
  OR OLD.idempotency_key IS NOT NEW.idempotency_key
  OR OLD.request_fingerprint_sha256 IS NOT NEW.request_fingerprint_sha256
  OR OLD.source_evidence_sha256 IS NOT NEW.source_evidence_sha256
  OR OLD.created_at_utc IS NOT NEW.created_at_utc
BEGIN SELECT RAISE(ABORT,'canonical imaging acquisition identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_acq_delete_restricted
BEFORE DELETE ON canonical_imaging_acquisitions
BEGIN SELECT RAISE(ABORT,'canonical imaging acquisition delete is restricted'); END;

-- DICOM hierarchy and provenance guards ---------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_study_identity_immutable
BEFORE UPDATE ON canonical_imaging_studies
WHEN OLD.tenant_id IS NOT NEW.tenant_id
  OR OLD.study_public_id IS NOT NEW.study_public_id
  OR OLD.acquisition_public_id IS NOT NEW.acquisition_public_id
  OR OLD.patient_link_public_id IS NOT NEW.patient_link_public_id
  OR OLD.encounter_public_id IS NOT NEW.encounter_public_id
  OR OLD.request_public_id IS NOT NEW.request_public_id
  OR OLD.service_public_id IS NOT NEW.service_public_id
  OR OLD.study_uid_namespace IS NOT NEW.study_uid_namespace
  OR OLD.study_instance_uid IS NOT NEW.study_instance_uid
  OR OLD.accession_namespace IS NOT NEW.accession_namespace
  OR OLD.accession_value IS NOT NEW.accession_value
  OR OLD.modality_code IS NOT NEW.modality_code
  OR OLD.study_started_at_utc IS NOT NEW.study_started_at_utc
  OR OLD.idempotency_key IS NOT NEW.idempotency_key
  OR OLD.request_fingerprint_sha256 IS NOT NEW.request_fingerprint_sha256
  OR OLD.source_evidence_sha256 IS NOT NEW.source_evidence_sha256
  OR OLD.created_at_utc IS NOT NEW.created_at_utc
BEGIN SELECT RAISE(ABORT,'canonical imaging study identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_study_delete_restricted
BEFORE DELETE ON canonical_imaging_studies
BEGIN SELECT RAISE(ABORT,'canonical imaging study delete is restricted'); END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_series_immutable_update
BEFORE UPDATE ON canonical_imaging_series
BEGIN SELECT RAISE(ABORT,'canonical imaging series identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_series_immutable_delete
BEFORE DELETE ON canonical_imaging_series
BEGIN SELECT RAISE(ABORT,'canonical imaging series delete is restricted'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_instance_immutable_update
BEFORE UPDATE ON canonical_imaging_instances
BEGIN SELECT RAISE(ABORT,'canonical imaging instance and storage identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_instance_immutable_delete
BEFORE DELETE ON canonical_imaging_instances
BEGIN SELECT RAISE(ABORT,'canonical imaging instance delete is restricted'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_provenance_immutable_update
BEFORE UPDATE ON canonical_imaging_provenance_events
BEGIN SELECT RAISE(ABORT,'canonical imaging provenance is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_provenance_immutable_delete
BEFORE DELETE ON canonical_imaging_provenance_events
BEGIN SELECT RAISE(ABORT,'canonical imaging provenance is immutable'); END;

-- Report version and signed lifecycle guards ----------------------------------
CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_report_version_sequence
BEFORE INSERT ON canonical_imaging_report_versions
WHEN NOT (
  (NEW.version_number=1 AND NOT EXISTS (
    SELECT 1 FROM canonical_imaging_report_versions v
    WHERE v.tenant_id=NEW.tenant_id AND v.report_set_public_id=NEW.report_set_public_id
  ))
  OR (NEW.version_number>1 AND EXISTS (
    SELECT 1 FROM canonical_imaging_report_versions v
    WHERE v.tenant_id=NEW.tenant_id AND v.report_set_public_id=NEW.report_set_public_id
      AND v.version_number=NEW.version_number-1
  ))
)
BEGIN SELECT RAISE(ABORT,'canonical imaging report version sequence is not contiguous'); END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_report_version_insert_draft
BEFORE INSERT ON canonical_imaging_report_versions
WHEN NEW.version_status!='draft'
  OR NEW.signed_content_sha256 IS NOT NULL
  OR NEW.verifying_practitioner_public_id IS NOT NULL
  OR NEW.finalising_practitioner_public_id IS NOT NULL
  OR NEW.verified_at_utc IS NOT NULL
  OR NEW.finalised_at_utc IS NOT NULL
  OR NEW.published_at_utc IS NOT NULL
  OR NEW.retracted_at_utc IS NOT NULL
BEGIN SELECT RAISE(ABORT,'canonical imaging report version must start as draft'); END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_report_version_content_immutable
BEFORE UPDATE ON canonical_imaging_report_versions
WHEN OLD.tenant_id IS NOT NEW.tenant_id
  OR OLD.version_public_id IS NOT NEW.version_public_id
  OR OLD.report_set_public_id IS NOT NEW.report_set_public_id
  OR OLD.version_number IS NOT NEW.version_number
  OR OLD.supersedes_version_public_id IS NOT NEW.supersedes_version_public_id
  OR OLD.version_kind IS NOT NEW.version_kind
  OR OLD.content_json IS NOT NEW.content_json
  OR OLD.content_sha256 IS NOT NEW.content_sha256
  OR OLD.authoring_practitioner_public_id IS NOT NEW.authoring_practitioner_public_id
  OR OLD.actor_user_public_id IS NOT NEW.actor_user_public_id
  OR OLD.actor_system_key IS NOT NEW.actor_system_key
  OR OLD.authored_at_utc IS NOT NEW.authored_at_utc
  OR OLD.reason_code IS NOT NEW.reason_code
  OR OLD.source_evidence_sha256 IS NOT NEW.source_evidence_sha256
  OR OLD.created_at_utc IS NOT NEW.created_at_utc
BEGIN SELECT RAISE(ABORT,'canonical imaging report content is immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_report_version_lifecycle_guard
BEFORE UPDATE OF version_status,signed_content_sha256,verifying_practitioner_public_id,
  finalising_practitioner_public_id,verified_at_utc,finalised_at_utc,published_at_utc,retracted_at_utc
ON canonical_imaging_report_versions
WHEN NOT (
  (
    (OLD.version_status='draft' AND NEW.version_status='verified')
    OR (OLD.version_status='verified' AND NEW.version_status='final')
    OR (OLD.version_status='final' AND NEW.version_status='published')
    OR (OLD.version_status NOT IN ('retracted','entered_in_error') AND NEW.version_status IN ('retracted','entered_in_error'))
  )
  AND EXISTS (
    SELECT 1 FROM canonical_imaging_report_status_events e
    WHERE e.tenant_id=NEW.tenant_id AND e.report_set_public_id=NEW.report_set_public_id
      AND e.version_public_id=NEW.version_public_id AND e.to_status=NEW.version_status
  )
  AND (
    (NEW.version_status='verified' AND NEW.signed_content_sha256=NEW.content_sha256 AND NEW.verifying_practitioner_public_id IS NOT NULL AND NEW.verified_at_utc IS NOT NULL)
    OR (NEW.version_status='final' AND NEW.signed_content_sha256=NEW.content_sha256 AND NEW.verifying_practitioner_public_id IS NOT NULL AND NEW.verified_at_utc IS NOT NULL AND NEW.finalising_practitioner_public_id IS NOT NULL AND NEW.finalised_at_utc IS NOT NULL)
    OR (NEW.version_status='published' AND NEW.signed_content_sha256=NEW.content_sha256 AND NEW.verifying_practitioner_public_id IS NOT NULL AND NEW.verified_at_utc IS NOT NULL AND NEW.finalising_practitioner_public_id IS NOT NULL AND NEW.finalised_at_utc IS NOT NULL AND NEW.published_at_utc IS NOT NULL)
    OR (NEW.version_status='retracted' AND NEW.reason_code IS NOT NULL AND NEW.retracted_at_utc IS NOT NULL)
    OR (NEW.version_status='entered_in_error' AND NEW.reason_code IS NOT NULL)
  )
)
BEGIN SELECT RAISE(ABORT,'canonical imaging report lifecycle requires matching signed status event'); END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_report_version_terminal_immutable
BEFORE UPDATE ON canonical_imaging_report_versions
WHEN OLD.version_status IN ('retracted','entered_in_error')
BEGIN SELECT RAISE(ABORT,'canonical imaging report history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_report_version_delete_restricted
BEFORE DELETE ON canonical_imaging_report_versions
BEGIN SELECT RAISE(ABORT,'canonical imaging report history is immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_report_event_state_guard
BEFORE INSERT ON canonical_imaging_report_status_events
WHEN NOT (
  (
    NEW.event_version=1 AND NEW.from_status IS NULL AND NEW.to_status='draft'
    AND NEW.event_type='draft_created'
    AND EXISTS (
      SELECT 1 FROM canonical_imaging_report_sets r
      WHERE r.tenant_id=NEW.tenant_id AND r.report_set_public_id=NEW.report_set_public_id
        AND r.current_status='draft' AND r.status_version=1
        AND r.current_status_event_public_id IS NULL
    )
  )
  OR (
    NEW.event_version>1 AND NEW.from_status IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM canonical_imaging_report_sets r
      WHERE r.tenant_id=NEW.tenant_id AND r.report_set_public_id=NEW.report_set_public_id
        AND r.current_status=NEW.from_status AND NEW.event_version=r.status_version+1
        AND (
          (r.current_version_public_id=NEW.version_public_id AND (
            (NEW.from_status='draft' AND NEW.to_status IN ('verified','retracted','entered_in_error'))
            OR (NEW.from_status='verified' AND NEW.to_status IN ('final','retracted','entered_in_error'))
            OR (NEW.from_status='final' AND NEW.to_status IN ('published','retracted','entered_in_error'))
            OR (NEW.from_status='published' AND NEW.to_status IN ('retracted','entered_in_error'))
          ))
          OR EXISTS (
            SELECT 1 FROM canonical_imaging_report_versions v
            WHERE v.tenant_id=NEW.tenant_id AND v.report_set_public_id=NEW.report_set_public_id
              AND v.version_public_id=NEW.version_public_id
              AND v.supersedes_version_public_id=r.current_version_public_id
              AND v.version_status='draft'
              AND (
                (NEW.event_type='draft_replaced' AND NEW.to_status='draft')
                OR (NEW.event_type='corrected' AND NEW.to_status='draft')
                OR (NEW.event_type='retracted' AND NEW.to_status='retracted')
                OR (NEW.event_type='entered_in_error' AND NEW.to_status='entered_in_error')
              )
          )
        )
    )
  )
)
BEGIN SELECT RAISE(ABORT,'canonical imaging report status event does not match current state or version'); END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_report_event_signature_guard
BEFORE INSERT ON canonical_imaging_report_status_events
WHEN NEW.event_type IN ('verified','finalised','published')
  AND NOT EXISTS (
    SELECT 1 FROM canonical_imaging_report_versions v
    WHERE v.tenant_id=NEW.tenant_id AND v.report_set_public_id=NEW.report_set_public_id
      AND v.version_public_id=NEW.version_public_id
      AND NEW.signed_content_sha256=v.content_sha256
  )
BEGIN SELECT RAISE(ABORT,'canonical imaging report signed content does not match version content'); END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_report_event_immutable_update
BEFORE UPDATE ON canonical_imaging_report_status_events
BEGIN SELECT RAISE(ABORT,'canonical imaging report status history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_report_event_immutable_delete
BEFORE DELETE ON canonical_imaging_report_status_events
BEGIN SELECT RAISE(ABORT,'canonical imaging report status history is immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_report_set_current_guard
BEFORE UPDATE OF current_version_public_id,current_status,status_version,current_status_event_public_id
ON canonical_imaging_report_sets
WHEN NOT (
  (
    OLD.current_version_public_id IS NULL AND NEW.current_version_public_id IS NOT NULL
    AND OLD.current_status='draft' AND NEW.current_status='draft'
    AND OLD.status_version=1 AND NEW.status_version=1
    AND NEW.current_status_event_public_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM canonical_imaging_report_versions v
      JOIN canonical_imaging_report_status_events e
        ON e.tenant_id=v.tenant_id AND e.report_set_public_id=v.report_set_public_id
       AND e.version_public_id=v.version_public_id
      WHERE v.tenant_id=NEW.tenant_id AND v.report_set_public_id=NEW.report_set_public_id
        AND v.version_public_id=NEW.current_version_public_id AND v.version_status='draft'
        AND e.event_public_id=NEW.current_status_event_public_id
        AND e.event_version=1 AND e.from_status IS NULL AND e.to_status='draft'
    )
  )
  OR (
    NEW.status_version=OLD.status_version+1
    AND NEW.current_version_public_id IS NOT NULL
    AND NEW.current_status_event_public_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM canonical_imaging_report_status_events e
      JOIN canonical_imaging_report_versions v
        ON v.tenant_id=e.tenant_id AND v.report_set_public_id=e.report_set_public_id
       AND v.version_public_id=e.version_public_id
      WHERE e.tenant_id=NEW.tenant_id AND e.report_set_public_id=NEW.report_set_public_id
        AND e.event_public_id=NEW.current_status_event_public_id
        AND e.event_version=NEW.status_version
        AND e.from_status=OLD.current_status AND e.to_status=NEW.current_status
        AND e.version_public_id=NEW.current_version_public_id
        AND v.version_status=NEW.current_status
    )
  )
)
BEGIN SELECT RAISE(ABORT,'canonical imaging report current state requires matching version and status event'); END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_report_set_identity_immutable
BEFORE UPDATE ON canonical_imaging_report_sets
WHEN OLD.tenant_id IS NOT NEW.tenant_id
  OR OLD.report_set_public_id IS NOT NEW.report_set_public_id
  OR OLD.patient_link_public_id IS NOT NEW.patient_link_public_id
  OR OLD.encounter_public_id IS NOT NEW.encounter_public_id
  OR OLD.request_public_id IS NOT NEW.request_public_id
  OR OLD.service_public_id IS NOT NEW.service_public_id
  OR OLD.acquisition_public_id IS NOT NEW.acquisition_public_id
  OR OLD.study_public_id IS NOT NEW.study_public_id
  OR OLD.reporting_practitioner_public_id IS NOT NEW.reporting_practitioner_public_id
  OR OLD.report_number_namespace IS NOT NEW.report_number_namespace
  OR OLD.report_number_value IS NOT NEW.report_number_value
  OR OLD.idempotency_key IS NOT NEW.idempotency_key
  OR OLD.request_fingerprint_sha256 IS NOT NEW.request_fingerprint_sha256
  OR OLD.source_evidence_sha256 IS NOT NEW.source_evidence_sha256
  OR OLD.created_at_utc IS NOT NEW.created_at_utc
BEGIN SELECT RAISE(ABORT,'canonical imaging report set identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_imaging_report_set_delete_restricted
BEFORE DELETE ON canonical_imaging_report_sets
BEGIN SELECT RAISE(ABORT,'canonical imaging report set delete is restricted'); END;
