-- =============================================================================
-- HMS Canonical Patient Vital Measurement Authority (D1 / SQLite)
-- Additive observation-set aggregate, typed components, immutable lifecycle events.
-- Existing vital tables remain compatibility sources until separately authorized.
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_encounters_vital_patient_scope
  ON canonical_encounters(tenant_id, encounter_public_id, patient_link_public_id);

CREATE TABLE IF NOT EXISTS canonical_vital_observation_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  observation_set_public_id TEXT NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  encounter_public_id TEXT,
  practitioner_public_id TEXT,
  source_kind TEXT NOT NULL,
  external_device_source_type TEXT,
  external_device_source_public_id TEXT,
  effective_at_utc TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending_review',
  status_version INTEGER NOT NULL DEFAULT 1,
  supersedes_observation_set_public_id TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  idempotency_key TEXT NOT NULL,
  request_fingerprint_sha256 TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_vital_observation_sets_source_kind_check CHECK (
    source_kind IN (
      'practitioner_entered','nurse_entered','patient_reported',
      'device_imported','system_derived','legacy_backfill'
    )
  ),
  CONSTRAINT canonical_vital_observation_sets_practitioner_check CHECK (
    source_kind NOT IN ('practitioner_entered','nurse_entered')
    OR practitioner_public_id IS NOT NULL
  ),
  CONSTRAINT canonical_vital_observation_sets_device_pair_check CHECK (
    (external_device_source_type IS NULL AND external_device_source_public_id IS NULL)
    OR (external_device_source_type IS NOT NULL AND external_device_source_public_id IS NOT NULL)
  ),
  CONSTRAINT canonical_vital_observation_sets_device_source_check CHECK (
    source_kind != 'device_imported'
    OR (external_device_source_type IS NOT NULL AND external_device_source_public_id IS NOT NULL)
  ),
  CONSTRAINT canonical_vital_observation_sets_status_check CHECK (
    review_status IN ('pending_review','verified','rejected','superseded','entered_in_error')
  ),
  CONSTRAINT canonical_vital_observation_sets_status_version_check CHECK (status_version > 0),
  CONSTRAINT canonical_vital_observation_sets_actor_check CHECK (
    actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL
  ),
  CONSTRAINT canonical_vital_observation_sets_self_supersession_check CHECK (
    supersedes_observation_set_public_id IS NULL
    OR supersedes_observation_set_public_id != observation_set_public_id
  ),
  CONSTRAINT canonical_vital_observation_sets_time_check CHECK (
    substr(effective_at_utc, -1) = 'Z'
    AND substr(recorded_at_utc, -1) = 'Z'
    AND recorded_at_utc >= effective_at_utc
    AND substr(created_at_utc, -1) = 'Z'
    AND substr(updated_at_utc, -1) = 'Z'
  ),
  CONSTRAINT canonical_vital_observation_sets_fingerprint_check CHECK (
    length(request_fingerprint_sha256) = 64
    AND request_fingerprint_sha256 = lower(request_fingerprint_sha256)
    AND request_fingerprint_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT canonical_vital_observation_sets_evidence_check CHECK (
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
  FOREIGN KEY (tenant_id, practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, supersedes_observation_set_public_id)
    REFERENCES canonical_vital_observation_sets(tenant_id, observation_set_public_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, observation_set_public_id),
  UNIQUE (tenant_id, observation_set_public_id, patient_link_public_id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, supersedes_observation_set_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_vital_observation_sets_patient_time
  ON canonical_vital_observation_sets(
    tenant_id,patient_link_public_id,effective_at_utc,observation_set_public_id
  );
CREATE INDEX IF NOT EXISTS idx_canonical_vital_observation_sets_encounter_time
  ON canonical_vital_observation_sets(
    tenant_id,encounter_public_id,effective_at_utc,observation_set_public_id
  );
CREATE INDEX IF NOT EXISTS idx_canonical_vital_observation_sets_review
  ON canonical_vital_observation_sets(
    tenant_id,review_status,recorded_at_utc,observation_set_public_id
  );
CREATE INDEX IF NOT EXISTS idx_canonical_vital_observation_sets_device
  ON canonical_vital_observation_sets(
    tenant_id,external_device_source_type,external_device_source_public_id,effective_at_utc
  );

CREATE TRIGGER IF NOT EXISTS trg_canonical_vital_observation_sets_pending_insert
BEFORE INSERT ON canonical_vital_observation_sets
WHEN NEW.review_status != 'pending_review' OR NEW.status_version != 1
BEGIN
  SELECT RAISE(ABORT, 'canonical vital observation set must start pending_review');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_vital_observation_sets_restrict_delete
BEFORE DELETE ON canonical_vital_observation_sets
BEGIN
  SELECT RAISE(ABORT, 'canonical vital observation set delete is restricted');
END;

CREATE TABLE IF NOT EXISTS canonical_vital_observation_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  component_public_id TEXT NOT NULL,
  observation_set_public_id TEXT NOT NULL,
  component_sequence INTEGER NOT NULL,
  measurement_code TEXT NOT NULL,
  numeric_value REAL NOT NULL,
  canonical_unit_code TEXT NOT NULL,
  source_numeric_value REAL,
  source_unit_code TEXT,
  method_code TEXT,
  body_site_code TEXT,
  posture_code TEXT,
  laterality_code TEXT,
  fasting_context_code TEXT,
  reference_low REAL,
  reference_high REAL,
  alert_level TEXT,
  is_derived INTEGER NOT NULL DEFAULT 0,
  derivation_formula_key TEXT,
  derivation_formula_version TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_vital_components_sequence_check CHECK (component_sequence > 0),
  CONSTRAINT canonical_vital_components_code_check CHECK (
    measurement_code IN (
      'body_temperature','heart_rate','respiratory_rate','oxygen_saturation',
      'blood_pressure_systolic','blood_pressure_diastolic','body_weight',
      'body_height','body_mass_index','pain_score','blood_glucose'
    )
  ),
  CONSTRAINT canonical_vital_components_unit_check CHECK (
    (measurement_code = 'body_temperature' AND canonical_unit_code = 'Cel')
    OR (measurement_code IN ('heart_rate','respiratory_rate') AND canonical_unit_code = '/min')
    OR (measurement_code = 'oxygen_saturation' AND canonical_unit_code = '%')
    OR (measurement_code IN ('blood_pressure_systolic','blood_pressure_diastolic') AND canonical_unit_code = 'mm[Hg]')
    OR (measurement_code = 'body_weight' AND canonical_unit_code = 'kg')
    OR (measurement_code = 'body_height' AND canonical_unit_code = 'cm')
    OR (measurement_code = 'body_mass_index' AND canonical_unit_code = 'kg/m2')
    OR (measurement_code = 'pain_score' AND canonical_unit_code = '{score}')
    OR (measurement_code = 'blood_glucose' AND canonical_unit_code = 'mg/dL')
  ),
  CONSTRAINT canonical_vital_components_value_check CHECK (
    numeric_value = numeric_value
    AND CASE measurement_code
      WHEN 'body_temperature' THEN numeric_value BETWEEN 20 AND 50
      WHEN 'heart_rate' THEN numeric_value BETWEEN 1 AND 350
      WHEN 'respiratory_rate' THEN numeric_value BETWEEN 1 AND 150
      WHEN 'oxygen_saturation' THEN numeric_value BETWEEN 0 AND 100
      WHEN 'blood_pressure_systolic' THEN numeric_value BETWEEN 20 AND 350
      WHEN 'blood_pressure_diastolic' THEN numeric_value BETWEEN 10 AND 250
      WHEN 'body_weight' THEN numeric_value > 0 AND numeric_value <= 1000
      WHEN 'body_height' THEN numeric_value > 0 AND numeric_value <= 300
      WHEN 'body_mass_index' THEN numeric_value > 0 AND numeric_value <= 200
      WHEN 'pain_score' THEN numeric_value BETWEEN 0 AND 10 AND numeric_value = CAST(numeric_value AS INTEGER)
      WHEN 'blood_glucose' THEN numeric_value > 0 AND numeric_value <= 3000
      ELSE 0
    END
  ),
  CONSTRAINT canonical_vital_components_source_pair_check CHECK (
    (source_numeric_value IS NULL AND source_unit_code IS NULL)
    OR (source_numeric_value IS NOT NULL AND source_unit_code IS NOT NULL)
  ),
  CONSTRAINT canonical_vital_components_reference_check CHECK (
    reference_low IS NULL OR reference_high IS NULL OR reference_low <= reference_high
  ),
  CONSTRAINT canonical_vital_components_alert_check CHECK (
    alert_level IS NULL OR alert_level IN ('normal','low','high','critical')
  ),
  CONSTRAINT canonical_vital_components_derived_check CHECK (
    (measurement_code = 'body_mass_index'
      AND is_derived = 1
      AND derivation_formula_key IS NOT NULL
      AND derivation_formula_version IS NOT NULL)
    OR (measurement_code != 'body_mass_index'
      AND is_derived = 0
      AND derivation_formula_key IS NULL
      AND derivation_formula_version IS NULL)
  ),
  CONSTRAINT canonical_vital_components_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT canonical_vital_components_created_time_check CHECK (substr(created_at_utc, -1) = 'Z'),
  FOREIGN KEY (tenant_id, observation_set_public_id)
    REFERENCES canonical_vital_observation_sets(tenant_id, observation_set_public_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, component_public_id),
  UNIQUE (tenant_id, observation_set_public_id, component_sequence),
  UNIQUE (tenant_id, observation_set_public_id, measurement_code)
);

CREATE INDEX IF NOT EXISTS idx_canonical_vital_components_set
  ON canonical_vital_observation_components(
    tenant_id,observation_set_public_id,component_sequence,component_public_id
  );
CREATE INDEX IF NOT EXISTS idx_canonical_vital_components_measurement
  ON canonical_vital_observation_components(
    tenant_id,measurement_code,canonical_unit_code,observation_set_public_id
  );

CREATE TRIGGER IF NOT EXISTS trg_canonical_vital_components_pending_set_insert
BEFORE INSERT ON canonical_vital_observation_components
WHEN NOT EXISTS (
  SELECT 1 FROM canonical_vital_observation_sets s
  WHERE s.tenant_id = NEW.tenant_id
    AND s.observation_set_public_id = NEW.observation_set_public_id
    AND s.review_status = 'pending_review'
)
BEGIN
  SELECT RAISE(ABORT, 'canonical vital components require a pending observation set');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_vital_components_immutable_update
BEFORE UPDATE ON canonical_vital_observation_components
BEGIN
  SELECT RAISE(ABORT, 'canonical vital observation component history is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_vital_components_immutable_delete
BEFORE DELETE ON canonical_vital_observation_components
BEGIN
  SELECT RAISE(ABORT, 'canonical vital observation component history is immutable');
END;

CREATE TABLE IF NOT EXISTS canonical_vital_observation_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  event_public_id TEXT NOT NULL,
  observation_set_public_id TEXT NOT NULL,
  from_review_status TEXT,
  to_review_status TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  actor_practitioner_public_id TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  occurred_at_utc TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_vital_events_from_status_check CHECK (
    from_review_status IS NULL
    OR from_review_status IN ('pending_review','verified','rejected','superseded','entered_in_error')
  ),
  CONSTRAINT canonical_vital_events_to_status_check CHECK (
    to_review_status IN ('pending_review','verified','rejected','superseded','entered_in_error')
  ),
  CONSTRAINT canonical_vital_events_version_check CHECK (event_version > 0),
  CONSTRAINT canonical_vital_events_type_check CHECK (
    event_type IN ('recorded','reviewed','verified','rejected','corrected','superseded','entered_in_error')
  ),
  CONSTRAINT canonical_vital_events_reason_check CHECK (length(trim(reason_code)) > 0),
  CONSTRAINT canonical_vital_events_actor_check CHECK (
    actor_practitioner_public_id IS NOT NULL
    OR actor_user_public_id IS NOT NULL
    OR actor_system_key IS NOT NULL
  ),
  CONSTRAINT canonical_vital_events_time_check CHECK (
    substr(occurred_at_utc, -1) = 'Z' AND substr(created_at_utc, -1) = 'Z'
  ),
  CONSTRAINT canonical_vital_events_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  FOREIGN KEY (tenant_id, observation_set_public_id)
    REFERENCES canonical_vital_observation_sets(tenant_id, observation_set_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, actor_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, event_public_id),
  UNIQUE (tenant_id, observation_set_public_id, event_version)
);

CREATE INDEX IF NOT EXISTS idx_canonical_vital_events_timeline
  ON canonical_vital_observation_status_events(
    tenant_id,observation_set_public_id,event_version,occurred_at_utc,event_public_id
  );
CREATE INDEX IF NOT EXISTS idx_canonical_vital_events_status
  ON canonical_vital_observation_status_events(
    tenant_id,to_review_status,occurred_at_utc,observation_set_public_id
  );

CREATE TRIGGER IF NOT EXISTS trg_canonical_vital_events_state_guard
BEFORE INSERT ON canonical_vital_observation_status_events
WHEN NOT (
  (NEW.event_version = 1
    AND NEW.from_review_status IS NULL
    AND NEW.to_review_status = 'pending_review'
    AND NEW.event_type = 'recorded'
    AND EXISTS (
      SELECT 1 FROM canonical_vital_observation_sets s
      WHERE s.tenant_id = NEW.tenant_id
        AND s.observation_set_public_id = NEW.observation_set_public_id
        AND s.review_status = 'pending_review'
        AND s.status_version = 1
    ))
  OR
  (NEW.event_version > 1
    AND NEW.from_review_status IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM canonical_vital_observation_sets s
      WHERE s.tenant_id = NEW.tenant_id
        AND s.observation_set_public_id = NEW.observation_set_public_id
        AND s.review_status = NEW.from_review_status
        AND NEW.event_version = s.status_version + 1
    ))
)
BEGIN
  SELECT RAISE(ABORT, 'canonical vital status event does not match current state');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_vital_events_immutable_update
BEFORE UPDATE ON canonical_vital_observation_status_events
BEGIN
  SELECT RAISE(ABORT, 'canonical vital observation status event history is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_vital_events_immutable_delete
BEFORE DELETE ON canonical_vital_observation_status_events
BEGIN
  SELECT RAISE(ABORT, 'canonical vital observation status event history is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_vital_sets_status_event_guard
BEFORE UPDATE OF review_status,status_version ON canonical_vital_observation_sets
WHEN NOT EXISTS (
  SELECT 1 FROM canonical_vital_observation_status_events e
  WHERE e.tenant_id = NEW.tenant_id
    AND e.observation_set_public_id = NEW.observation_set_public_id
    AND e.event_version = NEW.status_version
    AND e.from_review_status = OLD.review_status
    AND e.to_review_status = NEW.review_status
)
BEGIN
  SELECT RAISE(ABORT, 'canonical vital status transition requires matching status event');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_vital_sets_status_transition_guard
BEFORE UPDATE OF review_status,status_version ON canonical_vital_observation_sets
WHEN
  NEW.status_version != OLD.status_version + 1
  OR NOT (
    (OLD.review_status = 'pending_review' AND NEW.review_status IN ('verified','rejected','superseded','entered_in_error'))
    OR (OLD.review_status = 'verified' AND NEW.review_status IN ('superseded','entered_in_error'))
    OR (OLD.review_status = 'rejected' AND NEW.review_status = 'entered_in_error')
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid canonical vital status transition');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_vital_sets_component_completion_guard
BEFORE UPDATE OF review_status ON canonical_vital_observation_sets
WHEN NEW.review_status = 'verified'
  AND (
    NOT EXISTS (
      SELECT 1 FROM canonical_vital_observation_components c
      WHERE c.tenant_id = NEW.tenant_id
        AND c.observation_set_public_id = NEW.observation_set_public_id
    )
    OR (
      (SELECT COUNT(*) FROM canonical_vital_observation_components c
       WHERE c.tenant_id = NEW.tenant_id
         AND c.observation_set_public_id = NEW.observation_set_public_id
         AND c.measurement_code = 'blood_pressure_systolic')
      !=
      (SELECT COUNT(*) FROM canonical_vital_observation_components c
       WHERE c.tenant_id = NEW.tenant_id
         AND c.observation_set_public_id = NEW.observation_set_public_id
         AND c.measurement_code = 'blood_pressure_diastolic')
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'verified canonical vital set requires components and paired blood pressure');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_vital_sets_supersession_guard
BEFORE UPDATE OF review_status ON canonical_vital_observation_sets
WHEN NEW.review_status = 'superseded'
  AND NOT EXISTS (
    SELECT 1 FROM canonical_vital_observation_sets replacement
    WHERE replacement.tenant_id = OLD.tenant_id
      AND replacement.supersedes_observation_set_public_id = OLD.observation_set_public_id
  )
BEGIN
  SELECT RAISE(ABORT, 'superseded canonical vital set requires one replacement set');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_vital_sets_immutable_fields_guard
BEFORE UPDATE ON canonical_vital_observation_sets
WHEN
  OLD.tenant_id IS NOT NEW.tenant_id
  OR OLD.observation_set_public_id IS NOT NEW.observation_set_public_id
  OR OLD.patient_link_public_id IS NOT NEW.patient_link_public_id
  OR OLD.encounter_public_id IS NOT NEW.encounter_public_id
  OR OLD.practitioner_public_id IS NOT NEW.practitioner_public_id
  OR OLD.source_kind IS NOT NEW.source_kind
  OR OLD.external_device_source_type IS NOT NEW.external_device_source_type
  OR OLD.external_device_source_public_id IS NOT NEW.external_device_source_public_id
  OR OLD.effective_at_utc IS NOT NEW.effective_at_utc
  OR OLD.recorded_at_utc IS NOT NEW.recorded_at_utc
  OR OLD.supersedes_observation_set_public_id IS NOT NEW.supersedes_observation_set_public_id
  OR OLD.actor_user_public_id IS NOT NEW.actor_user_public_id
  OR OLD.actor_system_key IS NOT NEW.actor_system_key
  OR OLD.idempotency_key IS NOT NEW.idempotency_key
  OR OLD.request_fingerprint_sha256 IS NOT NEW.request_fingerprint_sha256
  OR OLD.source_evidence_sha256 IS NOT NEW.source_evidence_sha256
  OR OLD.created_at_utc IS NOT NEW.created_at_utc
BEGIN
  SELECT RAISE(ABORT, 'canonical vital observation fact fields are immutable');
END;
