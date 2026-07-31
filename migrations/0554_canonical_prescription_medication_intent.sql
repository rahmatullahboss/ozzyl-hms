-- =============================================================================
-- HMS Canonical Prescription and Medication-Intent Authority (D1 / SQLite)
-- Additive-only encounter-linked prescription documents, immutable versions,
-- clinical medication intent, lifecycle history, and safety evidence.
-- Medication administration, reconciliation, fulfilment, stock, billing, and
-- payment remain separate authorities. No legacy table is altered or retired.
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_prescriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  prescription_public_id TEXT NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  prescribing_practitioner_public_id TEXT NOT NULL,
  current_version_public_id TEXT,
  current_status TEXT NOT NULL DEFAULT 'draft',
  status_version INTEGER NOT NULL DEFAULT 1,
  authored_at_utc TEXT NOT NULL,
  finalized_at_utc TEXT,
  cancelled_at_utc TEXT,
  idempotency_key TEXT NOT NULL,
  request_fingerprint_sha256 TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_prescriptions_status_check CHECK (
    current_status IN ('draft','final','amended','cancelled','entered_in_error')
  ),
  CONSTRAINT canonical_prescriptions_status_version_check CHECK (status_version > 0),
  CONSTRAINT canonical_prescriptions_lifecycle_check CHECK (
    (current_status = 'draft' AND finalized_at_utc IS NULL AND cancelled_at_utc IS NULL)
    OR (
      current_status IN ('final','amended')
      AND finalized_at_utc IS NOT NULL
      AND cancelled_at_utc IS NULL
    )
    OR (
      current_status IN ('cancelled','entered_in_error')
      AND cancelled_at_utc IS NOT NULL
    )
  ),
  CONSTRAINT canonical_prescriptions_time_check CHECK (
    substr(authored_at_utc, -1) = 'Z'
    AND (
      finalized_at_utc IS NULL
      OR (substr(finalized_at_utc, -1) = 'Z' AND finalized_at_utc >= authored_at_utc)
    )
    AND (
      cancelled_at_utc IS NULL
      OR (substr(cancelled_at_utc, -1) = 'Z' AND cancelled_at_utc >= authored_at_utc)
    )
  ),
  CONSTRAINT canonical_prescriptions_fingerprint_check CHECK (
    length(request_fingerprint_sha256) = 64
    AND request_fingerprint_sha256 = lower(request_fingerprint_sha256)
    AND request_fingerprint_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT canonical_prescriptions_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  FOREIGN KEY (tenant_id, patient_link_public_id)
    REFERENCES canonical_tenant_patient_links(tenant_id, patient_link_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, encounter_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, prescribing_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, prescription_public_id, current_version_public_id)
    REFERENCES canonical_prescription_versions(
      tenant_id, prescription_public_id, version_public_id
    )
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, prescription_public_id),
  UNIQUE (
    tenant_id, prescription_public_id, patient_link_public_id,
    encounter_public_id, prescribing_practitioner_public_id
  ),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_canonical_prescriptions_patient_time
  ON canonical_prescriptions(
    tenant_id, patient_link_public_id, authored_at_utc, prescription_public_id
  );

CREATE INDEX IF NOT EXISTS idx_canonical_prescriptions_encounter_status
  ON canonical_prescriptions(
    tenant_id, encounter_public_id, current_status, authored_at_utc, prescription_public_id
  );

CREATE INDEX IF NOT EXISTS idx_canonical_prescriptions_prescriber_time
  ON canonical_prescriptions(
    tenant_id, prescribing_practitioner_public_id, authored_at_utc, prescription_public_id
  );

CREATE TABLE IF NOT EXISTS canonical_prescription_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  version_public_id TEXT NOT NULL,
  prescription_public_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  supersedes_version_public_id TEXT,
  version_status TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  signed_snapshot_sha256 TEXT,
  authored_at_utc TEXT NOT NULL,
  finalized_at_utc TEXT,
  authoring_practitioner_public_id TEXT NOT NULL,
  signing_practitioner_public_id TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_prescription_versions_number_check CHECK (version_number > 0),
  CONSTRAINT canonical_prescription_versions_status_check CHECK (
    version_status IN ('draft','final','amendment','retracted','entered_in_error')
  ),
  CONSTRAINT canonical_prescription_versions_self_supersession_check CHECK (
    supersedes_version_public_id IS NULL
    OR supersedes_version_public_id != version_public_id
  ),
  CONSTRAINT canonical_prescription_versions_actor_check CHECK (
    actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL
  ),
  CONSTRAINT canonical_prescription_versions_lifecycle_check CHECK (
    (
      version_status = 'draft'
      AND signed_snapshot_sha256 IS NULL
      AND finalized_at_utc IS NULL
    )
    OR (
      version_status IN ('final','amendment')
      AND signed_snapshot_sha256 IS NOT NULL
      AND finalized_at_utc IS NOT NULL
      AND signing_practitioner_public_id IS NOT NULL
    )
    OR version_status IN ('retracted','entered_in_error')
  ),
  CONSTRAINT canonical_prescription_versions_time_check CHECK (
    substr(authored_at_utc, -1) = 'Z'
    AND (
      finalized_at_utc IS NULL
      OR (substr(finalized_at_utc, -1) = 'Z' AND finalized_at_utc >= authored_at_utc)
    )
  ),
  CONSTRAINT canonical_prescription_versions_content_hash_check CHECK (
    length(content_sha256) = 64
    AND content_sha256 = lower(content_sha256)
    AND content_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT canonical_prescription_versions_signature_hash_check CHECK (
    signed_snapshot_sha256 IS NULL
    OR (
      length(signed_snapshot_sha256) = 64
      AND signed_snapshot_sha256 = lower(signed_snapshot_sha256)
      AND signed_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CONSTRAINT canonical_prescription_versions_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  FOREIGN KEY (tenant_id, prescription_public_id)
    REFERENCES canonical_prescriptions(tenant_id, prescription_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, prescription_public_id, supersedes_version_public_id)
    REFERENCES canonical_prescription_versions(
      tenant_id, prescription_public_id, version_public_id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, authoring_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, signing_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, version_public_id),
  UNIQUE (tenant_id, prescription_public_id, version_public_id),
  UNIQUE (tenant_id, prescription_public_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_canonical_prescription_versions_timeline
  ON canonical_prescription_versions(
    tenant_id, prescription_public_id, version_number, authored_at_utc
  );

CREATE INDEX IF NOT EXISTS idx_canonical_prescription_versions_status
  ON canonical_prescription_versions(
    tenant_id, version_status, finalized_at_utc, version_public_id
  );

CREATE TABLE IF NOT EXISTS canonical_medication_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  medication_order_public_id TEXT NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  prescribing_practitioner_public_id TEXT NOT NULL,
  prescription_public_id TEXT,
  prescription_version_public_id TEXT,
  medication_code_system TEXT,
  medication_code TEXT,
  medication_display TEXT NOT NULL,
  generic_display TEXT,
  strength_snapshot TEXT,
  dose_text TEXT NOT NULL,
  route_code TEXT NOT NULL,
  frequency_code TEXT NOT NULL,
  duration_text TEXT,
  instructions_text TEXT,
  priority TEXT NOT NULL DEFAULT 'routine',
  intended_start_utc TEXT NOT NULL,
  intended_end_utc TEXT,
  current_status TEXT NOT NULL DEFAULT 'draft',
  status_version INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL,
  request_fingerprint_sha256 TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_medication_orders_status_check CHECK (
    current_status IN (
      'draft','active','on_hold','completed','stopped','cancelled','entered_in_error'
    )
  ),
  CONSTRAINT canonical_medication_orders_status_version_check CHECK (status_version > 0),
  CONSTRAINT canonical_medication_orders_priority_check CHECK (
    priority IN ('routine','urgent','stat','prn')
  ),
  CONSTRAINT canonical_medication_orders_prescription_scope_check CHECK (
    (prescription_public_id IS NULL AND prescription_version_public_id IS NULL)
    OR (prescription_public_id IS NOT NULL AND prescription_version_public_id IS NOT NULL)
  ),
  CONSTRAINT canonical_medication_orders_code_pair_check CHECK (
    (medication_code_system IS NULL AND medication_code IS NULL)
    OR (medication_code_system IS NOT NULL AND medication_code IS NOT NULL)
  ),
  CONSTRAINT canonical_medication_orders_display_check CHECK (
    length(trim(medication_display)) > 0
    AND length(trim(dose_text)) > 0
    AND length(trim(route_code)) > 0
    AND length(trim(frequency_code)) > 0
  ),
  CONSTRAINT canonical_medication_orders_interval_check CHECK (
    substr(intended_start_utc, -1) = 'Z'
    AND (
      intended_end_utc IS NULL
      OR (substr(intended_end_utc, -1) = 'Z' AND intended_end_utc >= intended_start_utc)
    )
  ),
  CONSTRAINT canonical_medication_orders_fingerprint_check CHECK (
    length(request_fingerprint_sha256) = 64
    AND request_fingerprint_sha256 = lower(request_fingerprint_sha256)
    AND request_fingerprint_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT canonical_medication_orders_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  FOREIGN KEY (tenant_id, patient_link_public_id)
    REFERENCES canonical_tenant_patient_links(tenant_id, patient_link_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, encounter_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, prescribing_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    tenant_id, prescription_public_id, patient_link_public_id,
    encounter_public_id, prescribing_practitioner_public_id
  ) REFERENCES canonical_prescriptions(
    tenant_id, prescription_public_id, patient_link_public_id,
    encounter_public_id, prescribing_practitioner_public_id
  ) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, prescription_public_id, prescription_version_public_id)
    REFERENCES canonical_prescription_versions(
      tenant_id, prescription_public_id, version_public_id
    )
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, medication_order_public_id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_canonical_medication_orders_patient_status
  ON canonical_medication_orders(
    tenant_id, patient_link_public_id, current_status,
    intended_start_utc, medication_order_public_id
  );

CREATE INDEX IF NOT EXISTS idx_canonical_medication_orders_encounter_status
  ON canonical_medication_orders(
    tenant_id, encounter_public_id, current_status,
    intended_start_utc, medication_order_public_id
  );

CREATE INDEX IF NOT EXISTS idx_canonical_medication_orders_prescriber_status
  ON canonical_medication_orders(
    tenant_id, prescribing_practitioner_public_id, current_status,
    intended_start_utc, medication_order_public_id
  );

CREATE INDEX IF NOT EXISTS idx_canonical_medication_orders_prescription
  ON canonical_medication_orders(
    tenant_id, prescription_public_id, prescription_version_public_id,
    medication_order_public_id
  );

CREATE TABLE IF NOT EXISTS canonical_medication_order_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  event_public_id TEXT NOT NULL,
  medication_order_public_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  reason_code TEXT NOT NULL,
  safe_note TEXT,
  actor_practitioner_public_id TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  idempotency_key TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  occurred_at_utc TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_medication_order_status_events_from_check CHECK (
    from_status IS NULL OR from_status IN (
      'draft','active','on_hold','completed','stopped','cancelled','entered_in_error'
    )
  ),
  CONSTRAINT canonical_medication_order_status_events_to_check CHECK (
    to_status IN (
      'draft','active','on_hold','completed','stopped','cancelled','entered_in_error'
    )
  ),
  CONSTRAINT canonical_medication_order_status_events_transition_check CHECK (
    from_status IS NULL OR from_status != to_status
  ),
  CONSTRAINT canonical_medication_order_status_events_version_check CHECK (event_version > 0),
  CONSTRAINT canonical_medication_order_status_events_reason_check CHECK (
    length(trim(reason_code)) > 0
  ),
  CONSTRAINT canonical_medication_order_status_events_actor_check CHECK (
    actor_practitioner_public_id IS NOT NULL
    OR actor_user_public_id IS NOT NULL
    OR actor_system_key IS NOT NULL
  ),
  CONSTRAINT canonical_medication_order_status_events_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT canonical_medication_order_status_events_time_check CHECK (
    substr(occurred_at_utc, -1) = 'Z'
  ),
  FOREIGN KEY (tenant_id, medication_order_public_id)
    REFERENCES canonical_medication_orders(tenant_id, medication_order_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, actor_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, event_public_id),
  UNIQUE (tenant_id, medication_order_public_id, event_version),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_canonical_medication_order_status_events_timeline
  ON canonical_medication_order_status_events(
    tenant_id, medication_order_public_id, event_version, occurred_at_utc
  );

CREATE TABLE IF NOT EXISTS canonical_prescription_safety_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  event_public_id TEXT NOT NULL,
  prescription_public_id TEXT NOT NULL,
  prescription_version_public_id TEXT,
  medication_order_public_id TEXT,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  severity TEXT,
  evidence_code TEXT NOT NULL,
  actor_practitioner_public_id TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  idempotency_key TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  occurred_at_utc TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_prescription_safety_events_type_check CHECK (
    event_type IN (
      'allergy_check','interaction_check','duplicate_therapy_check',
      'dose_check','override','waiver','other'
    )
  ),
  CONSTRAINT canonical_prescription_safety_events_outcome_check CHECK (
    outcome IN ('passed','warning','blocked','overridden','not_applicable')
  ),
  CONSTRAINT canonical_prescription_safety_events_severity_check CHECK (
    severity IS NULL OR severity IN ('none','low','moderate','high','critical','unknown')
  ),
  CONSTRAINT canonical_prescription_safety_events_evidence_code_check CHECK (
    length(trim(evidence_code)) > 0
  ),
  CONSTRAINT canonical_prescription_safety_events_actor_check CHECK (
    actor_practitioner_public_id IS NOT NULL
    OR actor_user_public_id IS NOT NULL
    OR actor_system_key IS NOT NULL
  ),
  CONSTRAINT canonical_prescription_safety_events_override_check CHECK (
    event_type NOT IN ('override','waiver')
    OR (outcome = 'overridden' AND actor_practitioner_public_id IS NOT NULL)
  ),
  CONSTRAINT canonical_prescription_safety_events_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT canonical_prescription_safety_events_time_check CHECK (
    substr(occurred_at_utc, -1) = 'Z'
  ),
  FOREIGN KEY (tenant_id, prescription_public_id)
    REFERENCES canonical_prescriptions(tenant_id, prescription_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, prescription_public_id, prescription_version_public_id)
    REFERENCES canonical_prescription_versions(
      tenant_id, prescription_public_id, version_public_id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, medication_order_public_id)
    REFERENCES canonical_medication_orders(tenant_id, medication_order_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, actor_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, event_public_id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_canonical_prescription_safety_events_prescription
  ON canonical_prescription_safety_events(
    tenant_id, prescription_public_id, occurred_at_utc, event_public_id
  );

CREATE INDEX IF NOT EXISTS idx_canonical_prescription_safety_events_order
  ON canonical_prescription_safety_events(
    tenant_id, medication_order_public_id, occurred_at_utc, event_public_id
  );
