-- =============================================================================
-- HMS Canonical Emergency Case and Triage Authority (D1 / SQLite)
-- Additive-only emergency encounter extension. Legacy ER, visit, admission,
-- discharge-summary, file, quality-KPI, billing, and reporting sources remain
-- unchanged and authoritative until separately authorized cutover.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- Composite parent keys required by the exact tenant/patient/encounter and
-- signed-document foreign keys below. These indexes are additive and reuse the
-- existing authorities; they create no duplicate business facts.
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_encounters_emergency_patient_scope
  ON canonical_encounters(tenant_id, encounter_public_id, patient_link_public_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_vital_sets_emergency_scope
  ON canonical_vital_observation_sets(tenant_id, observation_set_public_id, patient_link_public_id, encounter_public_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_admissions_emergency_patient_scope
  ON canonical_admissions(tenant_id, admission_public_id, patient_link_public_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_document_versions_emergency_signed_scope
  ON canonical_clinical_document_versions(tenant_id, document_public_id, version_public_id, content_sha256);

CREATE TABLE IF NOT EXISTS canonical_emergency_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  emergency_case_public_id TEXT NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  emergency_number_namespace TEXT,
  emergency_number_value TEXT,
  current_status TEXT NOT NULL DEFAULT 'arrived',
  status_version INTEGER NOT NULL DEFAULT 1,
  current_arrival_assessment_public_id TEXT,
  current_status_event_public_id TEXT,
  current_triage_assessment_public_id TEXT,
  current_disposition_event_public_id TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  idempotency_key TEXT NOT NULL,
  request_fingerprint_sha256 TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (current_status IN (
    'arrived','awaiting_triage','triaged','care_in_progress','observation',
    'disposition_pending','admitted','discharged','transferred','lama','dor',
    'death','entered_in_error'
  )),
  CHECK (status_version > 0),
  CHECK ((emergency_number_namespace IS NULL) = (emergency_number_value IS NULL)),
  CHECK (emergency_number_namespace IS NULL OR length(trim(emergency_number_namespace)) > 0),
  CHECK (emergency_number_value IS NULL OR length(trim(emergency_number_value)) > 0),
  CHECK (actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL),
  CHECK (length(request_fingerprint_sha256) = 64 AND request_fingerprint_sha256 = lower(request_fingerprint_sha256)),
  CHECK (length(source_evidence_sha256) = 64 AND source_evidence_sha256 = lower(source_evidence_sha256)),
  FOREIGN KEY (tenant_id, patient_link_public_id)
    REFERENCES canonical_tenant_patient_links(tenant_id, patient_link_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, encounter_public_id, patient_link_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id, patient_link_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, emergency_case_public_id),
  UNIQUE (tenant_id, encounter_public_id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, emergency_number_namespace, emergency_number_value)
);

CREATE INDEX IF NOT EXISTS idx_canonical_emergency_cases_patient_status
  ON canonical_emergency_cases(tenant_id, patient_link_public_id, current_status, emergency_case_public_id);
CREATE INDEX IF NOT EXISTS idx_canonical_emergency_cases_encounter
  ON canonical_emergency_cases(tenant_id, encounter_public_id, emergency_case_public_id);

CREATE TABLE IF NOT EXISTS canonical_emergency_arrival_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  arrival_assessment_public_id TEXT NOT NULL,
  emergency_case_public_id TEXT NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  supersedes_arrival_assessment_public_id TEXT,
  version_kind TEXT NOT NULL,
  arrival_at_utc TEXT NOT NULL,
  mode_of_arrival_code TEXT NOT NULL,
  mode_source_type TEXT,
  mode_source_public_id TEXT,
  referral_source_type TEXT,
  referral_source_public_id TEXT,
  referral_snapshot TEXT,
  condition_on_arrival_code TEXT NOT NULL,
  condition_snapshot TEXT,
  brought_by_category TEXT,
  brought_by_relationship_category TEXT,
  police_case_indicator INTEGER NOT NULL DEFAULT 0,
  actor_practitioner_public_id TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  observed_at_utc TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  reason_code TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (version_number > 0),
  CHECK (version_kind IN ('initial','correction','entered_in_error')),
  CHECK ((version_number = 1 AND version_kind = 'initial' AND supersedes_arrival_assessment_public_id IS NULL)
      OR (version_number > 1 AND version_kind IN ('correction','entered_in_error')
          AND supersedes_arrival_assessment_public_id IS NOT NULL AND reason_code IS NOT NULL)),
  CHECK (length(trim(mode_of_arrival_code)) > 0),
  CHECK ((mode_source_type IS NULL) = (mode_source_public_id IS NULL)),
  CHECK ((referral_source_type IS NULL) = (referral_source_public_id IS NULL)),
  CHECK (length(trim(condition_on_arrival_code)) > 0),
  CHECK (police_case_indicator IN (0,1)),
  CHECK (recorded_at_utc >= observed_at_utc),
  CHECK (arrival_at_utc <= recorded_at_utc),
  CHECK (actor_practitioner_public_id IS NOT NULL OR actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL),
  CHECK (length(source_evidence_sha256) = 64 AND source_evidence_sha256 = lower(source_evidence_sha256)),
  FOREIGN KEY (tenant_id, emergency_case_public_id)
    REFERENCES canonical_emergency_cases(tenant_id, emergency_case_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, encounter_public_id, patient_link_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id, patient_link_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, actor_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, supersedes_arrival_assessment_public_id)
    REFERENCES canonical_emergency_arrival_assessments(tenant_id, arrival_assessment_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, arrival_assessment_public_id),
  UNIQUE (tenant_id, emergency_case_public_id, arrival_assessment_public_id),
  UNIQUE (tenant_id, emergency_case_public_id, version_number),
  UNIQUE (tenant_id, emergency_case_public_id, supersedes_arrival_assessment_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_emergency_arrivals_case_version
  ON canonical_emergency_arrival_assessments(tenant_id, emergency_case_public_id, version_number);

CREATE TABLE IF NOT EXISTS canonical_emergency_case_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  event_public_id TEXT NOT NULL,
  emergency_case_public_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_practitioner_public_id TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  occurred_at_utc TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (event_version > 0),
  CHECK (from_status IS NULL OR from_status IN (
    'arrived','awaiting_triage','triaged','care_in_progress','observation',
    'disposition_pending','admitted','discharged','transferred','lama','dor',
    'death','entered_in_error'
  )),
  CHECK (to_status IN (
    'arrived','awaiting_triage','triaged','care_in_progress','observation',
    'disposition_pending','admitted','discharged','transferred','lama','dor',
    'death','entered_in_error'
  )),
  CHECK (event_type IN (
    'registered','awaiting_triage','triaged','care_started','observation_started',
    'observation_ended','disposition_pending','admitted','discharged','transferred',
    'lama','dor','death','entered_in_error','corrected'
  )),
  CHECK (recorded_at_utc >= occurred_at_utc),
  CHECK (length(trim(reason_code)) > 0),
  CHECK (actor_practitioner_public_id IS NOT NULL OR actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL),
  CHECK (length(source_evidence_sha256) = 64 AND source_evidence_sha256 = lower(source_evidence_sha256)),
  FOREIGN KEY (tenant_id, emergency_case_public_id)
    REFERENCES canonical_emergency_cases(tenant_id, emergency_case_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, actor_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, event_public_id),
  UNIQUE (tenant_id, emergency_case_public_id, event_public_id),
  UNIQUE (tenant_id, emergency_case_public_id, event_version)
);

CREATE INDEX IF NOT EXISTS idx_canonical_emergency_status_events_case_version
  ON canonical_emergency_case_status_events(tenant_id, emergency_case_public_id, event_version, occurred_at_utc);

CREATE TABLE IF NOT EXISTS canonical_emergency_triage_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  triage_assessment_public_id TEXT NOT NULL,
  emergency_case_public_id TEXT NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  supersedes_triage_assessment_public_id TEXT,
  version_kind TEXT NOT NULL,
  acuity_code TEXT NOT NULL,
  legacy_acuity_code TEXT,
  triage_practitioner_public_id TEXT NOT NULL,
  vital_observation_set_public_id TEXT,
  presenting_risk_code TEXT,
  immediate_intervention_code TEXT,
  clinical_rationale_snapshot TEXT,
  observed_at_utc TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  reason_code TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (version_number > 0),
  CHECK (version_kind IN ('initial','reassessment','correction','entered_in_error')),
  CHECK ((version_number = 1 AND version_kind = 'initial' AND supersedes_triage_assessment_public_id IS NULL)
      OR (version_number > 1 AND version_kind IN ('reassessment','correction','entered_in_error')
          AND supersedes_triage_assessment_public_id IS NOT NULL AND reason_code IS NOT NULL)),
  CHECK (acuity_code IN ('red','yellow','green')),
  CHECK (recorded_at_utc >= observed_at_utc),
  CHECK (length(source_evidence_sha256) = 64 AND source_evidence_sha256 = lower(source_evidence_sha256)),
  FOREIGN KEY (tenant_id, emergency_case_public_id)
    REFERENCES canonical_emergency_cases(tenant_id, emergency_case_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, encounter_public_id, patient_link_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id, patient_link_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, triage_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, vital_observation_set_public_id, patient_link_public_id, encounter_public_id)
    REFERENCES canonical_vital_observation_sets(
      tenant_id, observation_set_public_id, patient_link_public_id, encounter_public_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, supersedes_triage_assessment_public_id)
    REFERENCES canonical_emergency_triage_assessments(tenant_id, triage_assessment_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, triage_assessment_public_id),
  UNIQUE (tenant_id, emergency_case_public_id, triage_assessment_public_id),
  UNIQUE (tenant_id, emergency_case_public_id, version_number),
  UNIQUE (tenant_id, emergency_case_public_id, supersedes_triage_assessment_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_emergency_triage_case_version
  ON canonical_emergency_triage_assessments(tenant_id, emergency_case_public_id, version_number, observed_at_utc);
CREATE INDEX IF NOT EXISTS idx_canonical_emergency_triage_acuity
  ON canonical_emergency_triage_assessments(tenant_id, acuity_code, observed_at_utc, emergency_case_public_id);

CREATE TABLE IF NOT EXISTS canonical_emergency_case_classifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  classification_public_id TEXT NOT NULL,
  classification_family_public_id TEXT NOT NULL,
  emergency_case_public_id TEXT NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  supersedes_classification_public_id TEXT,
  version_kind TEXT NOT NULL,
  classification_namespace TEXT NOT NULL,
  classification_code TEXT NOT NULL,
  category_code TEXT NOT NULL,
  subcategory_code TEXT,
  animal_category_code TEXT,
  bite_site_code TEXT,
  bite_at_utc TEXT,
  first_aid_code TEXT,
  police_case_indicator INTEGER NOT NULL DEFAULT 0,
  bounded_source_snapshot TEXT,
  actor_practitioner_public_id TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  occurred_at_utc TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  reason_code TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (version_number > 0),
  CHECK (version_kind IN ('initial','correction','entered_in_error')),
  CHECK ((version_number = 1 AND version_kind = 'initial' AND supersedes_classification_public_id IS NULL)
      OR (version_number > 1 AND version_kind IN ('correction','entered_in_error')
          AND supersedes_classification_public_id IS NOT NULL AND reason_code IS NOT NULL)),
  CHECK (length(trim(classification_namespace)) > 0),
  CHECK (length(trim(classification_code)) > 0),
  CHECK (length(trim(category_code)) > 0),
  CHECK (police_case_indicator IN (0,1)),
  CHECK (recorded_at_utc >= occurred_at_utc),
  CHECK (actor_practitioner_public_id IS NOT NULL OR actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL),
  CHECK (length(source_evidence_sha256) = 64 AND source_evidence_sha256 = lower(source_evidence_sha256)),
  FOREIGN KEY (tenant_id, emergency_case_public_id)
    REFERENCES canonical_emergency_cases(tenant_id, emergency_case_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, encounter_public_id, patient_link_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id, patient_link_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, actor_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, supersedes_classification_public_id)
    REFERENCES canonical_emergency_case_classifications(tenant_id, classification_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, classification_public_id),
  UNIQUE (tenant_id, classification_family_public_id, version_number),
  UNIQUE (tenant_id, classification_family_public_id, supersedes_classification_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_emergency_classifications_case
  ON canonical_emergency_case_classifications(
    tenant_id, emergency_case_public_id, classification_namespace, classification_code, version_number
  );

CREATE TABLE IF NOT EXISTS canonical_emergency_disposition_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  disposition_event_public_id TEXT NOT NULL,
  emergency_case_public_id TEXT NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  disposition_version INTEGER NOT NULL,
  disposition_code TEXT NOT NULL,
  actor_practitioner_public_id TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  canonical_admission_public_id TEXT,
  discharge_document_public_id TEXT,
  discharge_document_version_public_id TEXT,
  discharge_document_content_sha256 TEXT,
  receiving_organization_source_type TEXT,
  receiving_organization_source_public_id TEXT,
  receiving_encounter_source_type TEXT,
  receiving_encounter_source_public_id TEXT,
  transport_service_event_public_id TEXT,
  terminal_evidence_code TEXT,
  occurred_at_utc TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  remarks_snapshot TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (disposition_version > 0),
  CHECK (disposition_code IN (
    'admitted','discharged','transferred','lama','dor','death','observation_continuation','entered_in_error'
  )),
  CHECK ((discharge_document_public_id IS NULL AND discharge_document_version_public_id IS NULL
          AND discharge_document_content_sha256 IS NULL)
      OR (discharge_document_public_id IS NOT NULL AND discharge_document_version_public_id IS NOT NULL
          AND discharge_document_content_sha256 IS NOT NULL)),
  CHECK ((receiving_organization_source_type IS NULL) = (receiving_organization_source_public_id IS NULL)),
  CHECK ((receiving_encounter_source_type IS NULL) = (receiving_encounter_source_public_id IS NULL)),
  CHECK (recorded_at_utc >= occurred_at_utc),
  CHECK (length(trim(reason_code)) > 0),
  CHECK (actor_practitioner_public_id IS NOT NULL OR actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL),
  CHECK (discharge_document_content_sha256 IS NULL OR (
    length(discharge_document_content_sha256) = 64
    AND discharge_document_content_sha256 = lower(discharge_document_content_sha256)
  )),
  CHECK (length(source_evidence_sha256) = 64 AND source_evidence_sha256 = lower(source_evidence_sha256)),
  FOREIGN KEY (tenant_id, emergency_case_public_id)
    REFERENCES canonical_emergency_cases(tenant_id, emergency_case_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, encounter_public_id, patient_link_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id, patient_link_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, actor_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, canonical_admission_public_id, patient_link_public_id)
    REFERENCES canonical_admissions(tenant_id, admission_public_id, patient_link_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (
    tenant_id, discharge_document_public_id, discharge_document_version_public_id,
    discharge_document_content_sha256
  ) REFERENCES canonical_clinical_document_versions(
    tenant_id, document_public_id, version_public_id, content_sha256
  ) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, transport_service_event_public_id)
    REFERENCES canonical_service_events(tenant_id, event_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, disposition_event_public_id),
  UNIQUE (tenant_id, emergency_case_public_id, disposition_event_public_id),
  UNIQUE (tenant_id, emergency_case_public_id, disposition_version)
);

CREATE INDEX IF NOT EXISTS idx_canonical_emergency_dispositions_case_version
  ON canonical_emergency_disposition_events(tenant_id, emergency_case_public_id, disposition_version, occurred_at_utc);

-- -----------------------------------------------------------------------------
-- Exact scope and active-authority guards
-- -----------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_case_scope_insert
BEFORE INSERT ON canonical_emergency_cases
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM canonical_tenant_patient_links p
    WHERE p.tenant_id=NEW.tenant_id AND p.patient_link_public_id=NEW.patient_link_public_id
      AND p.link_status NOT IN ('rejected','retired') AND p.effective_to_utc IS NULL
  ) THEN RAISE(ABORT,'canonical emergency case requires active patient link') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM canonical_encounters e
    WHERE e.tenant_id=NEW.tenant_id AND e.encounter_public_id=NEW.encounter_public_id
      AND e.patient_link_public_id=NEW.patient_link_public_id AND e.encounter_type='emergency'
      AND e.status NOT IN ('cancelled')
  ) THEN RAISE(ABORT,'canonical emergency case patient encounter mismatch or non-emergency encounter') END;
  SELECT CASE WHEN NEW.current_status NOT IN ('arrived','awaiting_triage') OR NEW.status_version!=1
    THEN RAISE(ABORT,'canonical emergency case must start arrived or awaiting_triage at version 1') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_case_identity_update
BEFORE UPDATE ON canonical_emergency_cases
WHEN NEW.tenant_id IS NOT OLD.tenant_id
  OR NEW.emergency_case_public_id IS NOT OLD.emergency_case_public_id
  OR NEW.patient_link_public_id IS NOT OLD.patient_link_public_id
  OR NEW.encounter_public_id IS NOT OLD.encounter_public_id
  OR NEW.emergency_number_namespace IS NOT OLD.emergency_number_namespace
  OR NEW.emergency_number_value IS NOT OLD.emergency_number_value
  OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.request_fingerprint_sha256 IS NOT OLD.request_fingerprint_sha256
  OR NEW.source_evidence_sha256 IS NOT OLD.source_evidence_sha256
  OR NEW.created_at_utc IS NOT OLD.created_at_utc
BEGIN
  SELECT RAISE(ABORT,'canonical emergency case identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_case_arrival_pointer
BEFORE UPDATE OF current_arrival_assessment_public_id ON canonical_emergency_cases
WHEN NEW.current_arrival_assessment_public_id IS NOT OLD.current_arrival_assessment_public_id
BEGIN
  SELECT CASE WHEN NEW.current_arrival_assessment_public_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM canonical_emergency_arrival_assessments a
    WHERE a.tenant_id=NEW.tenant_id
      AND a.emergency_case_public_id=NEW.emergency_case_public_id
      AND a.patient_link_public_id=NEW.patient_link_public_id
      AND a.encounter_public_id=NEW.encounter_public_id
      AND a.arrival_assessment_public_id=NEW.current_arrival_assessment_public_id
      AND a.version_number=(
        SELECT MAX(a2.version_number) FROM canonical_emergency_arrival_assessments a2
        WHERE a2.tenant_id=NEW.tenant_id AND a2.emergency_case_public_id=NEW.emergency_case_public_id
      )
  ) THEN RAISE(ABORT,'canonical emergency arrival pointer requires matching latest assessment') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_case_triage_pointer
BEFORE UPDATE OF current_triage_assessment_public_id ON canonical_emergency_cases
WHEN NEW.current_triage_assessment_public_id IS NOT OLD.current_triage_assessment_public_id
BEGIN
  SELECT CASE WHEN NEW.current_triage_assessment_public_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM canonical_emergency_triage_assessments t
    WHERE t.tenant_id=NEW.tenant_id
      AND t.emergency_case_public_id=NEW.emergency_case_public_id
      AND t.patient_link_public_id=NEW.patient_link_public_id
      AND t.encounter_public_id=NEW.encounter_public_id
      AND t.triage_assessment_public_id=NEW.current_triage_assessment_public_id
      AND t.version_number=(
        SELECT MAX(t2.version_number) FROM canonical_emergency_triage_assessments t2
        WHERE t2.tenant_id=NEW.tenant_id AND t2.emergency_case_public_id=NEW.emergency_case_public_id
      )
  ) THEN RAISE(ABORT,'canonical emergency triage pointer requires matching latest assessment') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_case_status_pointer
BEFORE UPDATE OF current_status,status_version,current_status_event_public_id ON canonical_emergency_cases
WHEN NEW.current_status IS NOT OLD.current_status
  OR NEW.status_version IS NOT OLD.status_version
  OR NEW.current_status_event_public_id IS NOT OLD.current_status_event_public_id
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM canonical_emergency_case_status_events e
    WHERE e.tenant_id=NEW.tenant_id
      AND e.emergency_case_public_id=NEW.emergency_case_public_id
      AND e.event_public_id=NEW.current_status_event_public_id
      AND e.event_version=NEW.status_version
      AND e.to_status=NEW.current_status
  ) THEN RAISE(ABORT,'canonical emergency status pointer requires matching event') END;
  SELECT CASE WHEN OLD.current_status_event_public_id IS NULL
      AND (NEW.status_version!=1 OR NEW.current_status IS NOT OLD.current_status)
    THEN RAISE(ABORT,'canonical emergency initial status pointer must preserve version 1 status') END;
  SELECT CASE WHEN OLD.current_status_event_public_id IS NOT NULL
      AND NEW.current_status_event_public_id IS NOT OLD.current_status_event_public_id
      AND NEW.status_version!=OLD.status_version+1
    THEN RAISE(ABORT,'canonical emergency status version must advance by one') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_case_disposition_pointer
BEFORE UPDATE OF current_disposition_event_public_id,current_status ON canonical_emergency_cases
WHEN NEW.current_disposition_event_public_id IS NOT OLD.current_disposition_event_public_id
  OR NEW.current_status IN ('admitted','discharged','transferred','lama','dor','death','entered_in_error')
BEGIN
  SELECT CASE WHEN NEW.current_status IN ('admitted','discharged','transferred','lama','dor','death','entered_in_error')
    AND (NEW.current_disposition_event_public_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM canonical_emergency_disposition_events d
      WHERE d.tenant_id=NEW.tenant_id
        AND d.emergency_case_public_id=NEW.emergency_case_public_id
        AND d.patient_link_public_id=NEW.patient_link_public_id
        AND d.encounter_public_id=NEW.encounter_public_id
        AND d.disposition_event_public_id=NEW.current_disposition_event_public_id
        AND d.disposition_code=NEW.current_status
        AND d.disposition_version=(
          SELECT MAX(d2.disposition_version) FROM canonical_emergency_disposition_events d2
          WHERE d2.tenant_id=NEW.tenant_id AND d2.emergency_case_public_id=NEW.emergency_case_public_id
        )
    )) THEN RAISE(ABORT,'canonical emergency disposition pointer requires matching terminal evidence') END;
  SELECT CASE WHEN NEW.current_disposition_event_public_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM canonical_emergency_disposition_events d
      WHERE d.tenant_id=NEW.tenant_id AND d.emergency_case_public_id=NEW.emergency_case_public_id
        AND d.disposition_event_public_id=NEW.current_disposition_event_public_id
    ) THEN RAISE(ABORT,'canonical emergency disposition pointer requires matching evidence') END;
END;

-- -----------------------------------------------------------------------------
-- Immutable contiguous child histories and typed evidence
-- -----------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_arrival_insert_guard
BEFORE INSERT ON canonical_emergency_arrival_assessments
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM canonical_emergency_cases c
    WHERE c.tenant_id=NEW.tenant_id AND c.emergency_case_public_id=NEW.emergency_case_public_id
      AND c.patient_link_public_id=NEW.patient_link_public_id AND c.encounter_public_id=NEW.encounter_public_id
  ) THEN RAISE(ABORT,'canonical emergency arrival scope mismatch') END;
  SELECT CASE WHEN NEW.version_number != COALESCE((
    SELECT MAX(a.version_number)+1 FROM canonical_emergency_arrival_assessments a
    WHERE a.tenant_id=NEW.tenant_id AND a.emergency_case_public_id=NEW.emergency_case_public_id
  ),1) THEN RAISE(ABORT,'canonical emergency arrival versions must be contiguous') END;
  SELECT CASE WHEN NEW.version_number>1 AND NOT EXISTS (
    SELECT 1 FROM canonical_emergency_arrival_assessments p
    WHERE p.tenant_id=NEW.tenant_id AND p.emergency_case_public_id=NEW.emergency_case_public_id
      AND p.arrival_assessment_public_id=NEW.supersedes_arrival_assessment_public_id
      AND p.version_number=NEW.version_number-1
  ) THEN RAISE(ABORT,'canonical emergency arrival replacement must supersede previous version') END;
  SELECT CASE WHEN NEW.actor_practitioner_public_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM canonical_practitioners p
    WHERE p.tenant_id=NEW.tenant_id AND p.practitioner_public_id=NEW.actor_practitioner_public_id
      AND p.status='active'
  ) THEN RAISE(ABORT,'canonical emergency arrival requires active practitioner') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_status_event_insert_guard
BEFORE INSERT ON canonical_emergency_case_status_events
BEGIN
  SELECT CASE WHEN NEW.event_version != COALESCE((
    SELECT MAX(e.event_version)+1 FROM canonical_emergency_case_status_events e
    WHERE e.tenant_id=NEW.tenant_id AND e.emergency_case_public_id=NEW.emergency_case_public_id
  ),1) THEN RAISE(ABORT,'canonical emergency status events must be contiguous') END;
  SELECT CASE WHEN NEW.event_version=1 AND NOT (
    NEW.from_status IS NULL AND NEW.to_status IN ('arrived','awaiting_triage') AND NEW.event_type='registered'
  ) THEN RAISE(ABORT,'canonical emergency initial status event is invalid') END;
  SELECT CASE WHEN NEW.event_version>1 AND NOT EXISTS (
    SELECT 1 FROM canonical_emergency_case_status_events p
    WHERE p.tenant_id=NEW.tenant_id AND p.emergency_case_public_id=NEW.emergency_case_public_id
      AND p.event_version=NEW.event_version-1 AND p.to_status=NEW.from_status
  ) THEN RAISE(ABORT,'canonical emergency status from-state must match previous event') END;
  SELECT CASE WHEN NEW.event_version>1 AND NOT (
    (NEW.from_status='arrived' AND NEW.to_status IN ('awaiting_triage','triaged','care_in_progress','entered_in_error'))
    OR (NEW.from_status='awaiting_triage' AND NEW.to_status IN ('triaged','care_in_progress','entered_in_error'))
    OR (NEW.from_status='triaged' AND NEW.to_status IN ('care_in_progress','observation','disposition_pending','entered_in_error'))
    OR (NEW.from_status='care_in_progress' AND NEW.to_status IN ('observation','disposition_pending','entered_in_error'))
    OR (NEW.from_status='observation' AND NEW.to_status IN ('care_in_progress','disposition_pending','entered_in_error'))
    OR (NEW.from_status='disposition_pending' AND NEW.to_status IN (
      'care_in_progress','observation','admitted','discharged','transferred','lama','dor','death','entered_in_error'
    ))
    OR (NEW.from_status IN ('admitted','discharged','transferred','lama','dor','death')
      AND NEW.to_status='entered_in_error')
  ) THEN RAISE(ABORT,'canonical emergency lifecycle transition is invalid') END;
  SELECT CASE WHEN NEW.actor_practitioner_public_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM canonical_practitioners p
    WHERE p.tenant_id=NEW.tenant_id AND p.practitioner_public_id=NEW.actor_practitioner_public_id
      AND p.status='active'
  ) THEN RAISE(ABORT,'canonical emergency status event requires active practitioner') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_triage_insert_guard
BEFORE INSERT ON canonical_emergency_triage_assessments
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM canonical_emergency_cases c
    WHERE c.tenant_id=NEW.tenant_id AND c.emergency_case_public_id=NEW.emergency_case_public_id
      AND c.patient_link_public_id=NEW.patient_link_public_id AND c.encounter_public_id=NEW.encounter_public_id
  ) THEN RAISE(ABORT,'canonical emergency triage scope mismatch') END;
  SELECT CASE WHEN NEW.version_number != COALESCE((
    SELECT MAX(t.version_number)+1 FROM canonical_emergency_triage_assessments t
    WHERE t.tenant_id=NEW.tenant_id AND t.emergency_case_public_id=NEW.emergency_case_public_id
  ),1) THEN RAISE(ABORT,'canonical emergency triage versions must be contiguous') END;
  SELECT CASE WHEN NEW.version_number>1 AND NOT EXISTS (
    SELECT 1 FROM canonical_emergency_triage_assessments p
    WHERE p.tenant_id=NEW.tenant_id AND p.emergency_case_public_id=NEW.emergency_case_public_id
      AND p.triage_assessment_public_id=NEW.supersedes_triage_assessment_public_id
      AND p.version_number=NEW.version_number-1
  ) THEN RAISE(ABORT,'canonical emergency triage replacement must supersede previous version') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM canonical_practitioners p
    WHERE p.tenant_id=NEW.tenant_id AND p.practitioner_public_id=NEW.triage_practitioner_public_id
      AND p.status='active'
  ) THEN RAISE(ABORT,'canonical emergency triage requires active triage practitioner') END;
  SELECT CASE WHEN NEW.vital_observation_set_public_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM canonical_vital_observation_sets v
    WHERE v.tenant_id=NEW.tenant_id AND v.observation_set_public_id=NEW.vital_observation_set_public_id
      AND v.patient_link_public_id=NEW.patient_link_public_id AND v.encounter_public_id=NEW.encounter_public_id
      AND v.review_status!='entered_in_error'
  ) THEN RAISE(ABORT,'canonical emergency triage vital scope mismatch') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_classification_insert_guard
BEFORE INSERT ON canonical_emergency_case_classifications
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM canonical_emergency_cases c
    WHERE c.tenant_id=NEW.tenant_id AND c.emergency_case_public_id=NEW.emergency_case_public_id
      AND c.patient_link_public_id=NEW.patient_link_public_id AND c.encounter_public_id=NEW.encounter_public_id
  ) THEN RAISE(ABORT,'canonical emergency classification scope mismatch') END;
  SELECT CASE WHEN NEW.version_number != COALESCE((
    SELECT MAX(x.version_number)+1 FROM canonical_emergency_case_classifications x
    WHERE x.tenant_id=NEW.tenant_id AND x.classification_family_public_id=NEW.classification_family_public_id
  ),1) THEN RAISE(ABORT,'canonical emergency classification versions must be contiguous') END;
  SELECT CASE WHEN NEW.version_number>1 AND NOT EXISTS (
    SELECT 1 FROM canonical_emergency_case_classifications p
    WHERE p.tenant_id=NEW.tenant_id
      AND p.classification_family_public_id=NEW.classification_family_public_id
      AND p.classification_public_id=NEW.supersedes_classification_public_id
      AND p.version_number=NEW.version_number-1
      AND p.emergency_case_public_id=NEW.emergency_case_public_id
  ) THEN RAISE(ABORT,'canonical emergency classification replacement must supersede previous version') END;
  SELECT CASE WHEN NEW.category_code='animal_bite' AND (
    NEW.animal_category_code IS NULL OR NEW.bite_site_code IS NULL OR NEW.bite_at_utc IS NULL
  ) THEN RAISE(ABORT,'canonical emergency animal bite evidence is incomplete') END;
  SELECT CASE WHEN NEW.category_code='police_case' AND NEW.police_case_indicator!=1
    THEN RAISE(ABORT,'canonical emergency police case evidence is incomplete') END;
  SELECT CASE WHEN NEW.actor_practitioner_public_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM canonical_practitioners p
    WHERE p.tenant_id=NEW.tenant_id AND p.practitioner_public_id=NEW.actor_practitioner_public_id
      AND p.status='active'
  ) THEN RAISE(ABORT,'canonical emergency classification requires active practitioner') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_disposition_insert_guard
BEFORE INSERT ON canonical_emergency_disposition_events
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM canonical_emergency_cases c
    WHERE c.tenant_id=NEW.tenant_id AND c.emergency_case_public_id=NEW.emergency_case_public_id
      AND c.patient_link_public_id=NEW.patient_link_public_id AND c.encounter_public_id=NEW.encounter_public_id
  ) THEN RAISE(ABORT,'canonical emergency disposition scope mismatch') END;
  SELECT CASE WHEN NEW.disposition_version != COALESCE((
    SELECT MAX(d.disposition_version)+1 FROM canonical_emergency_disposition_events d
    WHERE d.tenant_id=NEW.tenant_id AND d.emergency_case_public_id=NEW.emergency_case_public_id
  ),1) THEN RAISE(ABORT,'canonical emergency disposition versions must be contiguous') END;
  SELECT CASE WHEN NEW.actor_practitioner_public_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM canonical_practitioners p
    WHERE p.tenant_id=NEW.tenant_id AND p.practitioner_public_id=NEW.actor_practitioner_public_id
      AND p.status='active'
  ) THEN RAISE(ABORT,'canonical emergency disposition requires active practitioner') END;
  SELECT CASE WHEN NEW.disposition_code='admitted' AND NEW.canonical_admission_public_id IS NULL
    THEN RAISE(ABORT,'canonical emergency admitted disposition requires admission evidence') END;
  SELECT CASE WHEN NEW.canonical_admission_public_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM canonical_admissions a
    WHERE a.tenant_id=NEW.tenant_id AND a.admission_public_id=NEW.canonical_admission_public_id
      AND a.patient_link_public_id=NEW.patient_link_public_id AND a.current_status!='entered_in_error'
  ) THEN RAISE(ABORT,'canonical emergency admission patient mismatch') END;
  SELECT CASE WHEN NEW.disposition_code!='admitted' AND NEW.canonical_admission_public_id IS NOT NULL
    THEN RAISE(ABORT,'canonical emergency admission evidence is only valid for admitted disposition') END;
  SELECT CASE WHEN NEW.disposition_code='discharged'
    AND NEW.discharge_document_public_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM canonical_clinical_document_versions v
      JOIN canonical_clinical_documents d
        ON d.tenant_id=v.tenant_id AND d.document_public_id=v.document_public_id
      JOIN canonical_clinical_document_signatures s
        ON s.tenant_id=v.tenant_id AND s.document_public_id=v.document_public_id
       AND s.version_public_id=v.version_public_id AND s.signed_content_sha256=v.content_sha256
      WHERE v.tenant_id=NEW.tenant_id
        AND v.document_public_id=NEW.discharge_document_public_id
        AND v.version_public_id=NEW.discharge_document_version_public_id
        AND v.content_sha256=NEW.discharge_document_content_sha256
        AND v.version_kind IN ('final','amendment')
        AND d.document_type='discharge_summary'
        AND d.patient_link_public_id=NEW.patient_link_public_id
        AND d.encounter_public_id=NEW.encounter_public_id
    ) THEN RAISE(ABORT,'canonical emergency discharge document scope mismatch or unsigned document') END;
  SELECT CASE WHEN NEW.disposition_code!='discharged' AND NEW.discharge_document_public_id IS NOT NULL
    THEN RAISE(ABORT,'canonical emergency discharge document is only valid for discharged disposition') END;
  SELECT CASE WHEN NEW.disposition_code='transferred' AND (
    NEW.receiving_organization_source_type IS NULL OR NEW.receiving_organization_source_public_id IS NULL
  ) THEN RAISE(ABORT,'canonical emergency transfer destination evidence is incomplete') END;
  SELECT CASE WHEN NEW.disposition_code IN ('lama','dor','death','entered_in_error')
    AND (NEW.terminal_evidence_code IS NULL OR length(trim(NEW.terminal_evidence_code))=0)
    THEN RAISE(ABORT,'canonical emergency typed terminal evidence is required') END;
  SELECT CASE WHEN NEW.transport_service_event_public_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM canonical_service_events e
    WHERE e.tenant_id=NEW.tenant_id AND e.event_public_id=NEW.transport_service_event_public_id
      AND e.encounter_public_id=NEW.encounter_public_id AND e.status='posted'
  ) THEN RAISE(ABORT,'canonical emergency transport service event scope mismatch') END;
END;

-- -----------------------------------------------------------------------------
-- Append-only history and hard-delete protection
-- -----------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_case_delete_block
BEFORE DELETE ON canonical_emergency_cases BEGIN
  SELECT RAISE(ABORT,'canonical emergency case delete is forbidden');
END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_arrival_update_block
BEFORE UPDATE ON canonical_emergency_arrival_assessments BEGIN
  SELECT RAISE(ABORT,'canonical emergency arrival history is immutable');
END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_arrival_delete_block
BEFORE DELETE ON canonical_emergency_arrival_assessments BEGIN
  SELECT RAISE(ABORT,'canonical emergency arrival delete is forbidden');
END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_status_update_block
BEFORE UPDATE ON canonical_emergency_case_status_events BEGIN
  SELECT RAISE(ABORT,'canonical emergency status history is immutable');
END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_status_delete_block
BEFORE DELETE ON canonical_emergency_case_status_events BEGIN
  SELECT RAISE(ABORT,'canonical emergency status delete is forbidden');
END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_triage_update_block
BEFORE UPDATE ON canonical_emergency_triage_assessments BEGIN
  SELECT RAISE(ABORT,'canonical emergency triage history is immutable');
END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_triage_delete_block
BEFORE DELETE ON canonical_emergency_triage_assessments BEGIN
  SELECT RAISE(ABORT,'canonical emergency triage delete is forbidden');
END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_classification_update_block
BEFORE UPDATE ON canonical_emergency_case_classifications BEGIN
  SELECT RAISE(ABORT,'canonical emergency classification history is immutable');
END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_classification_delete_block
BEFORE DELETE ON canonical_emergency_case_classifications BEGIN
  SELECT RAISE(ABORT,'canonical emergency classification delete is forbidden');
END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_disposition_update_block
BEFORE UPDATE ON canonical_emergency_disposition_events BEGIN
  SELECT RAISE(ABORT,'canonical emergency disposition history is immutable');
END;
CREATE TRIGGER IF NOT EXISTS trg_canonical_emergency_disposition_delete_block
BEFORE DELETE ON canonical_emergency_disposition_events BEGIN
  SELECT RAISE(ABORT,'canonical emergency disposition delete is forbidden');
END;
