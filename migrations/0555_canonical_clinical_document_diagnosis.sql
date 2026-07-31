-- =============================================================================
-- HMS Canonical Clinical Document and Diagnosis Authority (D1 / SQLite)
-- Additive-only immutable authored documents, versions, signatures, attachments,
-- coded diagnosis assertions, and diagnosis lifecycle events.
-- Existing canonical_encounter_addenda remains the sole encounter-addendum authority.
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_encounters_patient_scope
  ON canonical_encounters(tenant_id, encounter_public_id, patient_link_public_id);

CREATE TABLE IF NOT EXISTS canonical_clinical_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  document_public_id TEXT NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  encounter_public_id TEXT,
  scope_kind TEXT NOT NULL,
  authoring_practitioner_public_id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  current_version_public_id TEXT,
  current_status TEXT NOT NULL DEFAULT 'draft',
  status_version INTEGER NOT NULL DEFAULT 1,
  confidentiality_code TEXT NOT NULL DEFAULT 'normal',
  authored_at_utc TEXT NOT NULL,
  finalized_at_utc TEXT,
  entered_in_error_at_utc TEXT,
  idempotency_key TEXT NOT NULL,
  request_fingerprint_sha256 TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_clinical_documents_scope_kind_check CHECK (
    scope_kind IN ('patient','encounter')
  ),
  CONSTRAINT canonical_clinical_documents_scope_check CHECK (
    (scope_kind = 'patient' AND encounter_public_id IS NULL)
    OR (scope_kind = 'encounter' AND encounter_public_id IS NOT NULL)
  ),
  CONSTRAINT canonical_clinical_documents_type_check CHECK (
    document_type IN (
      'progress_note','soap_note','consultation_note','doctor_round_note',
      'treatment_plan','encounter_summary','discharge_summary','procedure_note',
      'operative_note','referral_note','other'
    )
  ),
  CONSTRAINT canonical_clinical_documents_status_check CHECK (
    current_status IN ('draft','final','amended','retracted','entered_in_error')
  ),
  CONSTRAINT canonical_clinical_documents_confidentiality_check CHECK (
    confidentiality_code IN ('normal','restricted','very_restricted')
  ),
  CONSTRAINT canonical_clinical_documents_status_version_check CHECK (status_version > 0),
  CONSTRAINT canonical_clinical_documents_lifecycle_check CHECK (
    (current_status = 'draft' AND finalized_at_utc IS NULL AND entered_in_error_at_utc IS NULL)
    OR (current_status IN ('final','amended','retracted') AND finalized_at_utc IS NOT NULL AND entered_in_error_at_utc IS NULL)
    OR (current_status = 'entered_in_error' AND entered_in_error_at_utc IS NOT NULL)
  ),
  CONSTRAINT canonical_clinical_documents_time_check CHECK (
    substr(authored_at_utc, -1) = 'Z'
    AND (finalized_at_utc IS NULL OR (substr(finalized_at_utc, -1) = 'Z' AND finalized_at_utc >= authored_at_utc))
    AND (entered_in_error_at_utc IS NULL OR (substr(entered_in_error_at_utc, -1) = 'Z' AND entered_in_error_at_utc >= authored_at_utc))
  ),
  CONSTRAINT canonical_clinical_documents_fingerprint_check CHECK (
    length(request_fingerprint_sha256) = 64
    AND request_fingerprint_sha256 = lower(request_fingerprint_sha256)
    AND request_fingerprint_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT canonical_clinical_documents_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  FOREIGN KEY (tenant_id, patient_link_public_id)
    REFERENCES canonical_tenant_patient_links(tenant_id, patient_link_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, encounter_public_id, patient_link_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id, patient_link_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, authoring_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, document_public_id, current_version_public_id)
    REFERENCES canonical_clinical_document_versions(tenant_id, document_public_id, version_public_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, document_public_id),
  UNIQUE (tenant_id, document_public_id, patient_link_public_id),
  UNIQUE (tenant_id, document_public_id, encounter_public_id),
  UNIQUE (tenant_id, document_public_id, patient_link_public_id, encounter_public_id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_canonical_clinical_documents_patient_time
  ON canonical_clinical_documents(tenant_id, patient_link_public_id, authored_at_utc, document_public_id);
CREATE INDEX IF NOT EXISTS idx_canonical_clinical_documents_encounter_status
  ON canonical_clinical_documents(tenant_id, encounter_public_id, current_status, authored_at_utc, document_public_id);
CREATE INDEX IF NOT EXISTS idx_canonical_clinical_documents_author_time
  ON canonical_clinical_documents(tenant_id, authoring_practitioner_public_id, authored_at_utc, document_public_id);
CREATE INDEX IF NOT EXISTS idx_canonical_clinical_documents_type_status
  ON canonical_clinical_documents(tenant_id, document_type, current_status, authored_at_utc);

CREATE TABLE IF NOT EXISTS canonical_clinical_document_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  version_public_id TEXT NOT NULL,
  document_public_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  supersedes_version_public_id TEXT,
  version_kind TEXT NOT NULL,
  content_format TEXT NOT NULL,
  content_payload TEXT,
  encrypted_payload_reference TEXT,
  encryption_key_version TEXT,
  content_sha256 TEXT NOT NULL,
  section_manifest_json TEXT,
  authoring_practitioner_public_id TEXT NOT NULL,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  authored_at_utc TEXT NOT NULL,
  finalized_at_utc TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_clinical_document_versions_number_check CHECK (version_number > 0),
  CONSTRAINT canonical_clinical_document_versions_kind_check CHECK (
    version_kind IN ('draft','final','amendment','retraction','entered_in_error')
  ),
  CONSTRAINT canonical_clinical_document_versions_format_check CHECK (
    content_format IN ('plain_text','soap_json','structured_json','markdown','html','fhir_composition_json')
  ),
  CONSTRAINT canonical_clinical_document_versions_payload_check CHECK (
    (content_payload IS NOT NULL AND encrypted_payload_reference IS NULL AND encryption_key_version IS NULL)
    OR (content_payload IS NULL AND encrypted_payload_reference IS NOT NULL AND encryption_key_version IS NOT NULL)
  ),
  CONSTRAINT canonical_clinical_document_versions_manifest_check CHECK (
    section_manifest_json IS NULL OR json_valid(section_manifest_json)
  ),
  CONSTRAINT canonical_clinical_document_versions_self_supersession_check CHECK (
    supersedes_version_public_id IS NULL OR supersedes_version_public_id != version_public_id
  ),
  CONSTRAINT canonical_clinical_document_versions_actor_check CHECK (
    actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL
  ),
  CONSTRAINT canonical_clinical_document_versions_lifecycle_check CHECK (
    (version_kind = 'draft' AND finalized_at_utc IS NULL)
    OR (version_kind IN ('final','amendment','retraction','entered_in_error') AND finalized_at_utc IS NOT NULL)
  ),
  CONSTRAINT canonical_clinical_document_versions_time_check CHECK (
    substr(authored_at_utc, -1) = 'Z'
    AND (finalized_at_utc IS NULL OR (substr(finalized_at_utc, -1) = 'Z' AND finalized_at_utc >= authored_at_utc))
  ),
  CONSTRAINT canonical_clinical_document_versions_content_hash_check CHECK (
    length(content_sha256) = 64
    AND content_sha256 = lower(content_sha256)
    AND content_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT canonical_clinical_document_versions_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  FOREIGN KEY (tenant_id, document_public_id)
    REFERENCES canonical_clinical_documents(tenant_id, document_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, document_public_id, supersedes_version_public_id)
    REFERENCES canonical_clinical_document_versions(tenant_id, document_public_id, version_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, authoring_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, version_public_id),
  UNIQUE (tenant_id, document_public_id, version_public_id),
  UNIQUE (tenant_id, document_public_id, version_number),
  UNIQUE (tenant_id, document_public_id, version_public_id, content_sha256)
);

CREATE INDEX IF NOT EXISTS idx_canonical_clinical_document_versions_timeline
  ON canonical_clinical_document_versions(tenant_id, document_public_id, version_number, authored_at_utc);
CREATE INDEX IF NOT EXISTS idx_canonical_clinical_document_versions_kind
  ON canonical_clinical_document_versions(tenant_id, version_kind, finalized_at_utc, version_public_id);

CREATE TRIGGER IF NOT EXISTS trg_canonical_clinical_document_versions_draft_insert
BEFORE INSERT ON canonical_clinical_document_versions
WHEN NEW.version_kind != 'draft' OR NEW.finalized_at_utc IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'canonical clinical document version must start as draft');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_clinical_document_versions_immutable_update
BEFORE UPDATE ON canonical_clinical_document_versions
WHEN
  OLD.tenant_id IS NOT NEW.tenant_id
  OR OLD.version_public_id IS NOT NEW.version_public_id
  OR OLD.document_public_id IS NOT NEW.document_public_id
  OR OLD.version_number IS NOT NEW.version_number
  OR OLD.supersedes_version_public_id IS NOT NEW.supersedes_version_public_id
  OR OLD.content_format IS NOT NEW.content_format
  OR OLD.content_payload IS NOT NEW.content_payload
  OR OLD.encrypted_payload_reference IS NOT NEW.encrypted_payload_reference
  OR OLD.encryption_key_version IS NOT NEW.encryption_key_version
  OR OLD.content_sha256 IS NOT NEW.content_sha256
  OR OLD.section_manifest_json IS NOT NEW.section_manifest_json
  OR OLD.authoring_practitioner_public_id IS NOT NEW.authoring_practitioner_public_id
  OR OLD.actor_user_public_id IS NOT NEW.actor_user_public_id
  OR OLD.actor_system_key IS NOT NEW.actor_system_key
  OR OLD.authored_at_utc IS NOT NEW.authored_at_utc
  OR OLD.source_evidence_sha256 IS NOT NEW.source_evidence_sha256
  OR OLD.created_at_utc IS NOT NEW.created_at_utc
  OR OLD.version_kind != 'draft'
  OR NEW.version_kind NOT IN ('final','amendment')
  OR NEW.finalized_at_utc IS NULL
BEGIN
  SELECT RAISE(ABORT, 'canonical clinical document version history is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_clinical_document_versions_immutable_delete
BEFORE DELETE ON canonical_clinical_document_versions
BEGIN
  SELECT RAISE(ABORT, 'canonical clinical document version history is immutable');
END;

CREATE TABLE IF NOT EXISTS canonical_clinical_document_signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  signature_public_id TEXT NOT NULL,
  document_public_id TEXT NOT NULL,
  version_public_id TEXT NOT NULL,
  signer_practitioner_public_id TEXT NOT NULL,
  actor_user_public_id TEXT,
  signature_method TEXT NOT NULL,
  signed_content_sha256 TEXT NOT NULL,
  attestation_sha256 TEXT NOT NULL,
  signing_key_reference TEXT,
  signed_at_utc TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_clinical_document_signatures_method_check CHECK (
    signature_method IN ('authenticated_attestation','digital_signature','imported_legacy_signature','system_seal')
  ),
  CONSTRAINT canonical_clinical_document_signatures_time_check CHECK (substr(signed_at_utc, -1) = 'Z'),
  CONSTRAINT canonical_clinical_document_signatures_content_hash_check CHECK (
    length(signed_content_sha256) = 64
    AND signed_content_sha256 = lower(signed_content_sha256)
    AND signed_content_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT canonical_clinical_document_signatures_attestation_hash_check CHECK (
    length(attestation_sha256) = 64
    AND attestation_sha256 = lower(attestation_sha256)
    AND attestation_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT canonical_clinical_document_signatures_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  FOREIGN KEY (tenant_id, document_public_id)
    REFERENCES canonical_clinical_documents(tenant_id, document_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, document_public_id, version_public_id, signed_content_sha256)
    REFERENCES canonical_clinical_document_versions(tenant_id, document_public_id, version_public_id, content_sha256)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, signer_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, signature_public_id),
  UNIQUE (tenant_id, document_public_id, version_public_id, signer_practitioner_public_id, signature_method)
);

CREATE INDEX IF NOT EXISTS idx_canonical_clinical_document_signatures_version
  ON canonical_clinical_document_signatures(tenant_id, document_public_id, version_public_id, signed_at_utc);

CREATE TRIGGER IF NOT EXISTS trg_canonical_clinical_document_signatures_immutable_update
BEFORE UPDATE ON canonical_clinical_document_signatures
BEGIN
  SELECT RAISE(ABORT, 'canonical clinical document signature history is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_clinical_document_signatures_immutable_delete
BEFORE DELETE ON canonical_clinical_document_signatures
BEGIN
  SELECT RAISE(ABORT, 'canonical clinical document signature history is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_clinical_document_versions_signature_guard
BEFORE UPDATE OF version_kind, finalized_at_utc ON canonical_clinical_document_versions
WHEN NEW.version_kind IN ('final','amendment')
  AND NOT EXISTS (
    SELECT 1
    FROM canonical_clinical_document_signatures s
    WHERE s.tenant_id = NEW.tenant_id
      AND s.document_public_id = NEW.document_public_id
      AND s.version_public_id = NEW.version_public_id
      AND s.signed_content_sha256 = NEW.content_sha256
  )
BEGIN
  SELECT RAISE(ABORT, 'clinical document finalization requires matching signature');
END;

CREATE TABLE IF NOT EXISTS canonical_clinical_document_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  attachment_public_id TEXT NOT NULL,
  document_public_id TEXT NOT NULL,
  version_public_id TEXT,
  patient_link_public_id TEXT NOT NULL,
  encounter_public_id TEXT,
  attachment_type TEXT NOT NULL,
  body_part_code TEXT,
  storage_provider TEXT NOT NULL,
  object_reference TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  original_filename TEXT,
  uploader_practitioner_public_id TEXT,
  uploader_user_public_id TEXT,
  uploader_system_key TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'active',
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_clinical_document_attachments_type_check CHECK (
    attachment_type IN ('clinical_image','scanned_document','external_report','audio','video','other')
  ),
  CONSTRAINT canonical_clinical_document_attachments_status_check CHECK (
    lifecycle_status IN ('active','superseded','retracted','entered_in_error')
  ),
  CONSTRAINT canonical_clinical_document_attachments_actor_check CHECK (
    uploader_practitioner_public_id IS NOT NULL
    OR uploader_user_public_id IS NOT NULL
    OR uploader_system_key IS NOT NULL
  ),
  CONSTRAINT canonical_clinical_document_attachments_storage_check CHECK (
    length(trim(storage_provider)) > 0 AND length(trim(object_reference)) > 0
  ),
  CONSTRAINT canonical_clinical_document_attachments_size_check CHECK (file_size_bytes >= 0),
  CONSTRAINT canonical_clinical_document_attachments_mime_check CHECK (length(trim(mime_type)) > 0),
  CONSTRAINT canonical_clinical_document_attachments_content_hash_check CHECK (
    length(content_sha256) = 64
    AND content_sha256 = lower(content_sha256)
    AND content_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT canonical_clinical_document_attachments_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  FOREIGN KEY (tenant_id, patient_link_public_id)
    REFERENCES canonical_tenant_patient_links(tenant_id, patient_link_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, document_public_id, patient_link_public_id)
    REFERENCES canonical_clinical_documents(tenant_id, document_public_id, patient_link_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, document_public_id, encounter_public_id)
    REFERENCES canonical_clinical_documents(tenant_id, document_public_id, encounter_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, document_public_id, version_public_id)
    REFERENCES canonical_clinical_document_versions(tenant_id, document_public_id, version_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, uploader_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, attachment_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_clinical_document_attachments_document
  ON canonical_clinical_document_attachments(tenant_id, document_public_id, version_public_id, lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_canonical_clinical_document_attachments_patient
  ON canonical_clinical_document_attachments(tenant_id, patient_link_public_id, created_at_utc, attachment_public_id);

CREATE TRIGGER IF NOT EXISTS trg_canonical_clinical_document_attachments_restrict_delete
BEFORE DELETE ON canonical_clinical_document_attachments
BEGIN
  SELECT RAISE(ABORT, 'canonical clinical document attachment history is restricted');
END;

CREATE TABLE IF NOT EXISTS canonical_diagnosis_assertions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  diagnosis_public_id TEXT NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  asserting_practitioner_public_id TEXT NOT NULL,
  supporting_document_public_id TEXT,
  supporting_version_public_id TEXT,
  code_system TEXT NOT NULL,
  code_system_version TEXT,
  code TEXT NOT NULL,
  display_snapshot TEXT NOT NULL,
  coding_public_id TEXT,
  diagnosis_role TEXT NOT NULL,
  certainty TEXT NOT NULL,
  clinical_status TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  status_version INTEGER NOT NULL DEFAULT 1,
  asserted_at_utc TEXT NOT NULL,
  reviewed_at_utc TEXT,
  resolved_at_utc TEXT,
  entered_in_error_at_utc TEXT,
  idempotency_key TEXT NOT NULL,
  request_fingerprint_sha256 TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_diagnosis_assertions_support_pair_check CHECK (
    (supporting_document_public_id IS NULL AND supporting_version_public_id IS NULL)
    OR (supporting_document_public_id IS NOT NULL AND supporting_version_public_id IS NOT NULL)
  ),
  CONSTRAINT canonical_diagnosis_assertions_code_system_check CHECK (
    code_system IN ('icd10','icd11','snomed_ct','local','other')
  ),
  CONSTRAINT canonical_diagnosis_assertions_code_check CHECK (
    length(trim(code)) > 0 AND length(trim(display_snapshot)) > 0
  ),
  CONSTRAINT canonical_diagnosis_assertions_role_check CHECK (
    diagnosis_role IN ('primary','secondary','admitting','discharge','differential','other')
  ),
  CONSTRAINT canonical_diagnosis_assertions_certainty_check CHECK (
    certainty IN ('suspected','probable','confirmed','ruled_out','unknown')
  ),
  CONSTRAINT canonical_diagnosis_assertions_clinical_status_check CHECK (
    clinical_status IN ('active','resolved','inactive','unknown')
  ),
  CONSTRAINT canonical_diagnosis_assertions_verification_status_check CHECK (
    verification_status IN ('unverified','provisional','verified','refuted','entered_in_error')
  ),
  CONSTRAINT canonical_diagnosis_assertions_status_version_check CHECK (status_version > 0),
  CONSTRAINT canonical_diagnosis_assertions_review_check CHECK (
    verification_status IN ('unverified','provisional') OR reviewed_at_utc IS NOT NULL
  ),
  CONSTRAINT canonical_diagnosis_assertions_resolution_check CHECK (
    clinical_status != 'resolved' OR resolved_at_utc IS NOT NULL
  ),
  CONSTRAINT canonical_diagnosis_assertions_error_check CHECK (
    verification_status != 'entered_in_error' OR entered_in_error_at_utc IS NOT NULL
  ),
  CONSTRAINT canonical_diagnosis_assertions_time_check CHECK (
    substr(asserted_at_utc, -1) = 'Z'
    AND (reviewed_at_utc IS NULL OR (substr(reviewed_at_utc, -1) = 'Z' AND reviewed_at_utc >= asserted_at_utc))
    AND (resolved_at_utc IS NULL OR (substr(resolved_at_utc, -1) = 'Z' AND resolved_at_utc >= asserted_at_utc))
    AND (entered_in_error_at_utc IS NULL OR (substr(entered_in_error_at_utc, -1) = 'Z' AND entered_in_error_at_utc >= asserted_at_utc))
  ),
  CONSTRAINT canonical_diagnosis_assertions_fingerprint_check CHECK (
    length(request_fingerprint_sha256) = 64
    AND request_fingerprint_sha256 = lower(request_fingerprint_sha256)
    AND request_fingerprint_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT canonical_diagnosis_assertions_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  FOREIGN KEY (tenant_id, patient_link_public_id)
    REFERENCES canonical_tenant_patient_links(tenant_id, patient_link_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, encounter_public_id, patient_link_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id, patient_link_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, asserting_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, supporting_document_public_id, patient_link_public_id)
    REFERENCES canonical_clinical_documents(tenant_id, document_public_id, patient_link_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, supporting_document_public_id, encounter_public_id)
    REFERENCES canonical_clinical_documents(tenant_id, document_public_id, encounter_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, supporting_document_public_id, supporting_version_public_id)
    REFERENCES canonical_clinical_document_versions(tenant_id, document_public_id, version_public_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, diagnosis_public_id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_canonical_diagnosis_assertions_patient_status
  ON canonical_diagnosis_assertions(tenant_id, patient_link_public_id, clinical_status, asserted_at_utc, diagnosis_public_id);
CREATE INDEX IF NOT EXISTS idx_canonical_diagnosis_assertions_encounter_role
  ON canonical_diagnosis_assertions(tenant_id, encounter_public_id, diagnosis_role, verification_status, asserted_at_utc);
CREATE INDEX IF NOT EXISTS idx_canonical_diagnosis_assertions_code
  ON canonical_diagnosis_assertions(tenant_id, code_system, code, verification_status, diagnosis_public_id);

CREATE TABLE IF NOT EXISTS canonical_diagnosis_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  event_public_id TEXT NOT NULL,
  diagnosis_public_id TEXT NOT NULL,
  from_verification_status TEXT,
  to_verification_status TEXT NOT NULL,
  from_clinical_status TEXT,
  to_clinical_status TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  actor_practitioner_public_id TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  occurred_at_utc TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_diagnosis_status_events_from_verification_check CHECK (
    from_verification_status IS NULL OR from_verification_status IN ('unverified','provisional','verified','refuted','entered_in_error')
  ),
  CONSTRAINT canonical_diagnosis_status_events_to_verification_check CHECK (
    to_verification_status IN ('unverified','provisional','verified','refuted','entered_in_error')
  ),
  CONSTRAINT canonical_diagnosis_status_events_from_clinical_check CHECK (
    from_clinical_status IS NULL OR from_clinical_status IN ('active','resolved','inactive','unknown')
  ),
  CONSTRAINT canonical_diagnosis_status_events_to_clinical_check CHECK (
    to_clinical_status IN ('active','resolved','inactive','unknown')
  ),
  CONSTRAINT canonical_diagnosis_status_events_type_check CHECK (
    event_type IN ('asserted','reviewed','confirmed','refuted','resolved','reopened','entered_in_error')
  ),
  CONSTRAINT canonical_diagnosis_status_events_version_check CHECK (event_version > 0),
  CONSTRAINT canonical_diagnosis_status_events_reason_check CHECK (length(trim(reason_code)) > 0),
  CONSTRAINT canonical_diagnosis_status_events_actor_check CHECK (
    actor_practitioner_public_id IS NOT NULL OR actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL
  ),
  CONSTRAINT canonical_diagnosis_status_events_time_check CHECK (substr(occurred_at_utc, -1) = 'Z'),
  CONSTRAINT canonical_diagnosis_status_events_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  FOREIGN KEY (tenant_id, diagnosis_public_id)
    REFERENCES canonical_diagnosis_assertions(tenant_id, diagnosis_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, actor_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, event_public_id),
  UNIQUE (tenant_id, diagnosis_public_id, event_version)
);

CREATE INDEX IF NOT EXISTS idx_canonical_diagnosis_status_events_timeline
  ON canonical_diagnosis_status_events(tenant_id, diagnosis_public_id, event_version, occurred_at_utc);
CREATE INDEX IF NOT EXISTS idx_canonical_diagnosis_status_events_type
  ON canonical_diagnosis_status_events(tenant_id, event_type, occurred_at_utc, diagnosis_public_id);

CREATE TRIGGER IF NOT EXISTS trg_canonical_diagnosis_status_events_immutable_update
BEFORE UPDATE ON canonical_diagnosis_status_events
BEGIN
  SELECT RAISE(ABORT, 'canonical diagnosis status event history is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_diagnosis_status_events_immutable_delete
BEFORE DELETE ON canonical_diagnosis_status_events
BEGIN
  SELECT RAISE(ABORT, 'canonical diagnosis status event history is immutable');
END;
