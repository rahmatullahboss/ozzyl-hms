-- =============================================================================
-- HMS Canonical Medication Administration and Reconciliation Authority
-- Additive-only immutable administration events and versioned reconciliation.
-- Existing MAR, medication-order, reconciliation, and discharge tables remain
-- compatibility sources/workflows until separately authorized.
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_encounters_medication_admin_patient_scope
  ON canonical_encounters(tenant_id, encounter_public_id, patient_link_public_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_medication_orders_administration_scope
  ON canonical_medication_orders(
    tenant_id, medication_order_public_id, patient_link_public_id, encounter_public_id
  );

CREATE TABLE IF NOT EXISTS canonical_medication_administration_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  administration_event_public_id TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  medication_order_public_id TEXT NOT NULL,
  medication_order_status_version INTEGER NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  administering_practitioner_public_id TEXT NOT NULL,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  scheduled_at_utc TEXT,
  occurred_at_utc TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  late_entry_reason_code TEXT,
  outcome_code TEXT,
  administered_dose_value_decimal TEXT,
  administered_dose_unit_code TEXT,
  route_code TEXT,
  site_code TEXT,
  method_code TEXT,
  reason_code TEXT,
  dispense_source_type TEXT,
  dispense_source_public_id TEXT,
  lot_source_type TEXT,
  lot_source_public_id TEXT,
  barcode_source_type TEXT,
  barcode_source_public_id TEXT,
  device_source_type TEXT,
  device_source_public_id TEXT,
  supersedes_administration_event_public_id TEXT,
  idempotency_key TEXT NOT NULL,
  request_fingerprint_sha256 TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_med_admin_event_kind_check CHECK (
    event_kind IN ('administration','correction','entered_in_error')
  ),
  CONSTRAINT canonical_med_admin_event_version_check CHECK (medication_order_status_version > 0),
  CONSTRAINT canonical_med_admin_actor_check CHECK (
    actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL
  ),
  CONSTRAINT canonical_med_admin_supersession_check CHECK (
    (event_kind = 'administration' AND supersedes_administration_event_public_id IS NULL)
    OR (
      event_kind IN ('correction','entered_in_error')
      AND supersedes_administration_event_public_id IS NOT NULL
      AND supersedes_administration_event_public_id != administration_event_public_id
    )
  ),
  CONSTRAINT canonical_med_admin_outcome_check CHECK (
    (
      event_kind IN ('administration','correction')
      AND outcome_code IN (
        'given','partially_given','withheld','refused','omitted',
        'not_available','cancelled'
      )
    )
    OR (
      event_kind = 'entered_in_error'
      AND outcome_code IS NULL
      AND administered_dose_value_decimal IS NULL
      AND administered_dose_unit_code IS NULL
      AND route_code IS NULL
      AND site_code IS NULL
      AND method_code IS NULL
      AND reason_code IS NOT NULL
    )
  ),
  CONSTRAINT canonical_med_admin_dose_pair_check CHECK (
    (administered_dose_value_decimal IS NULL AND administered_dose_unit_code IS NULL)
    OR (
      administered_dose_value_decimal IS NOT NULL
      AND administered_dose_unit_code IS NOT NULL
      AND administered_dose_value_decimal = trim(administered_dose_value_decimal)
      AND length(administered_dose_value_decimal) > 0
      AND administered_dose_value_decimal NOT GLOB '*[^0-9.-]*'
      AND administered_dose_value_decimal NOT LIKE '.%'
      AND administered_dose_value_decimal NOT LIKE '%.'
      AND administered_dose_value_decimal NOT GLOB '*.*.*'
      AND administered_dose_value_decimal NOT GLOB '*-*-*'
      AND (
        instr(administered_dose_value_decimal, '-') = 0
        OR instr(administered_dose_value_decimal, '-') = 1
      )
      AND CAST(administered_dose_value_decimal AS REAL) > 0
      AND length(trim(administered_dose_unit_code)) > 0
    )
  ),
  CONSTRAINT canonical_med_admin_given_check CHECK (
    outcome_code NOT IN ('given','partially_given')
    OR (
      administered_dose_value_decimal IS NOT NULL
      AND administered_dose_unit_code IS NOT NULL
      AND route_code IS NOT NULL
      AND length(trim(route_code)) > 0
    )
  ),
  CONSTRAINT canonical_med_admin_non_administration_check CHECK (
    outcome_code NOT IN ('withheld','refused','omitted','not_available','cancelled')
    OR (
      administered_dose_value_decimal IS NULL
      AND administered_dose_unit_code IS NULL
      AND route_code IS NULL
      AND reason_code IS NOT NULL
      AND length(trim(reason_code)) > 0
    )
  ),
  CONSTRAINT canonical_med_admin_time_check CHECK (
    (scheduled_at_utc IS NULL OR substr(scheduled_at_utc, -1) = 'Z')
    AND substr(occurred_at_utc, -1) = 'Z'
    AND substr(recorded_at_utc, -1) = 'Z'
    AND (
      recorded_at_utc >= occurred_at_utc
      OR (late_entry_reason_code IS NOT NULL AND length(trim(late_entry_reason_code)) > 0)
    )
    AND substr(created_at_utc, -1) = 'Z'
  ),
  CONSTRAINT canonical_med_admin_dispense_pair_check CHECK (
    (dispense_source_type IS NULL AND dispense_source_public_id IS NULL)
    OR (dispense_source_type IS NOT NULL AND dispense_source_public_id IS NOT NULL)
  ),
  CONSTRAINT canonical_med_admin_lot_pair_check CHECK (
    (lot_source_type IS NULL AND lot_source_public_id IS NULL)
    OR (lot_source_type IS NOT NULL AND lot_source_public_id IS NOT NULL)
  ),
  CONSTRAINT canonical_med_admin_barcode_pair_check CHECK (
    (barcode_source_type IS NULL AND barcode_source_public_id IS NULL)
    OR (barcode_source_type IS NOT NULL AND barcode_source_public_id IS NOT NULL)
  ),
  CONSTRAINT canonical_med_admin_device_pair_check CHECK (
    (device_source_type IS NULL AND device_source_public_id IS NULL)
    OR (device_source_type IS NOT NULL AND device_source_public_id IS NOT NULL)
  ),
  CONSTRAINT canonical_med_admin_fingerprint_check CHECK (
    length(request_fingerprint_sha256) = 64
    AND request_fingerprint_sha256 = lower(request_fingerprint_sha256)
    AND request_fingerprint_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT canonical_med_admin_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  FOREIGN KEY (
    tenant_id, medication_order_public_id, patient_link_public_id, encounter_public_id
  ) REFERENCES canonical_medication_orders(
    tenant_id, medication_order_public_id, patient_link_public_id, encounter_public_id
  ) ON DELETE RESTRICT,
  FOREIGN KEY (
    tenant_id, medication_order_public_id, medication_order_status_version
  ) REFERENCES canonical_medication_order_status_events(
    tenant_id, medication_order_public_id, event_version
  ) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, patient_link_public_id)
    REFERENCES canonical_tenant_patient_links(tenant_id, patient_link_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, encounter_public_id, patient_link_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id, patient_link_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, administering_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    tenant_id, medication_order_public_id, patient_link_public_id, encounter_public_id,
    supersedes_administration_event_public_id
  ) REFERENCES canonical_medication_administration_events(
    tenant_id, medication_order_public_id, patient_link_public_id, encounter_public_id,
    administration_event_public_id
  ) ON DELETE RESTRICT,
  UNIQUE (tenant_id, administration_event_public_id),
  UNIQUE (
    tenant_id, medication_order_public_id, patient_link_public_id, encounter_public_id,
    administration_event_public_id
  ),
  UNIQUE (tenant_id, supersedes_administration_event_public_id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_canonical_med_admin_order_time
  ON canonical_medication_administration_events(
    tenant_id, medication_order_public_id, occurred_at_utc, administration_event_public_id
  );
CREATE INDEX IF NOT EXISTS idx_canonical_med_admin_patient_time
  ON canonical_medication_administration_events(
    tenant_id, patient_link_public_id, occurred_at_utc, administration_event_public_id
  );
CREATE INDEX IF NOT EXISTS idx_canonical_med_admin_encounter_time
  ON canonical_medication_administration_events(
    tenant_id, encounter_public_id, occurred_at_utc, administration_event_public_id
  );
CREATE INDEX IF NOT EXISTS idx_canonical_med_admin_outcome_time
  ON canonical_medication_administration_events(
    tenant_id, outcome_code, occurred_at_utc, administration_event_public_id
  );

CREATE TRIGGER IF NOT EXISTS trg_canonical_med_admin_immutable_update
BEFORE UPDATE ON canonical_medication_administration_events
BEGIN
  SELECT RAISE(ABORT, 'canonical medication administration history is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_med_admin_immutable_delete
BEFORE DELETE ON canonical_medication_administration_events
BEGIN
  SELECT RAISE(ABORT, 'canonical medication administration history is immutable');
END;

CREATE TABLE IF NOT EXISTS canonical_medication_reconciliations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  reconciliation_public_id TEXT NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  reconciliation_type TEXT NOT NULL,
  current_version_public_id TEXT,
  current_status TEXT NOT NULL DEFAULT 'draft',
  status_version INTEGER NOT NULL DEFAULT 1,
  creating_practitioner_public_id TEXT NOT NULL,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  idempotency_key TEXT NOT NULL,
  request_fingerprint_sha256 TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_med_reconciliation_type_check CHECK (
    reconciliation_type IN ('admission','transfer','discharge')
  ),
  CONSTRAINT canonical_med_reconciliation_status_check CHECK (
    current_status IN ('draft','final','cancelled','entered_in_error')
  ),
  CONSTRAINT canonical_med_reconciliation_status_version_check CHECK (status_version > 0),
  CONSTRAINT canonical_med_reconciliation_actor_check CHECK (
    actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL
  ),
  CONSTRAINT canonical_med_reconciliation_fingerprint_check CHECK (
    length(request_fingerprint_sha256) = 64
    AND request_fingerprint_sha256 = lower(request_fingerprint_sha256)
    AND request_fingerprint_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT canonical_med_reconciliation_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT canonical_med_reconciliation_time_check CHECK (
    substr(created_at_utc, -1) = 'Z' AND substr(updated_at_utc, -1) = 'Z'
  ),
  FOREIGN KEY (tenant_id, patient_link_public_id)
    REFERENCES canonical_tenant_patient_links(tenant_id, patient_link_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, encounter_public_id, patient_link_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id, patient_link_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, creating_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, reconciliation_public_id, current_version_public_id)
    REFERENCES canonical_medication_reconciliation_versions(
      tenant_id, reconciliation_public_id, version_public_id
    ) ON DELETE RESTRICT,
  UNIQUE (tenant_id, reconciliation_public_id),
  UNIQUE (tenant_id, reconciliation_public_id, patient_link_public_id, encounter_public_id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_canonical_med_reconciliation_patient_status
  ON canonical_medication_reconciliations(
    tenant_id, patient_link_public_id, current_status, reconciliation_public_id
  );
CREATE INDEX IF NOT EXISTS idx_canonical_med_reconciliation_encounter_type
  ON canonical_medication_reconciliations(
    tenant_id, encounter_public_id, reconciliation_type, current_status
  );

CREATE TRIGGER IF NOT EXISTS trg_canonical_med_reconciliation_restrict_delete
BEFORE DELETE ON canonical_medication_reconciliations
BEGIN
  SELECT RAISE(ABORT, 'canonical medication reconciliation delete is restricted');
END;

CREATE TABLE IF NOT EXISTS canonical_medication_reconciliation_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  version_public_id TEXT NOT NULL,
  reconciliation_public_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  supersedes_version_public_id TEXT,
  version_status TEXT NOT NULL DEFAULT 'draft',
  source_summary_sha256 TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  signed_content_sha256 TEXT,
  authoring_practitioner_public_id TEXT NOT NULL,
  finalizing_practitioner_public_id TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  authored_at_utc TEXT NOT NULL,
  finalized_at_utc TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_med_reconciliation_version_number_check CHECK (version_number > 0),
  CONSTRAINT canonical_med_reconciliation_version_status_check CHECK (
    version_status IN ('draft','final','cancelled','entered_in_error')
  ),
  CONSTRAINT canonical_med_reconciliation_version_insert_lifecycle_check CHECK (
    (
      version_status = 'draft'
      AND signed_content_sha256 IS NULL
      AND finalizing_practitioner_public_id IS NULL
      AND finalized_at_utc IS NULL
    )
    OR (
      version_status = 'final'
      AND signed_content_sha256 IS NOT NULL
      AND signed_content_sha256 = content_sha256
      AND finalizing_practitioner_public_id IS NOT NULL
      AND finalized_at_utc IS NOT NULL
    )
    OR version_status IN ('cancelled','entered_in_error')
  ),
  CONSTRAINT canonical_med_reconciliation_version_actor_check CHECK (
    actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL
  ),
  CONSTRAINT canonical_med_reconciliation_version_self_supersession_check CHECK (
    supersedes_version_public_id IS NULL OR supersedes_version_public_id != version_public_id
  ),
  CONSTRAINT canonical_med_reconciliation_version_time_check CHECK (
    substr(authored_at_utc, -1) = 'Z'
    AND (
      finalized_at_utc IS NULL
      OR (substr(finalized_at_utc, -1) = 'Z' AND finalized_at_utc >= authored_at_utc)
    )
    AND substr(created_at_utc, -1) = 'Z'
  ),
  CONSTRAINT canonical_med_reconciliation_version_source_hash_check CHECK (
    length(source_summary_sha256) = 64
    AND source_summary_sha256 = lower(source_summary_sha256)
    AND source_summary_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT canonical_med_reconciliation_version_content_hash_check CHECK (
    length(content_sha256) = 64
    AND content_sha256 = lower(content_sha256)
    AND content_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT canonical_med_reconciliation_version_signed_hash_check CHECK (
    signed_content_sha256 IS NULL
    OR (
      length(signed_content_sha256) = 64
      AND signed_content_sha256 = lower(signed_content_sha256)
      AND signed_content_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CONSTRAINT canonical_med_reconciliation_version_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  FOREIGN KEY (tenant_id, reconciliation_public_id)
    REFERENCES canonical_medication_reconciliations(tenant_id, reconciliation_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, reconciliation_public_id, supersedes_version_public_id)
    REFERENCES canonical_medication_reconciliation_versions(
      tenant_id, reconciliation_public_id, version_public_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, authoring_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, finalizing_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, version_public_id),
  UNIQUE (tenant_id, reconciliation_public_id, version_public_id),
  UNIQUE (tenant_id, reconciliation_public_id, version_number),
  UNIQUE (tenant_id, reconciliation_public_id, supersedes_version_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_med_reconciliation_versions_timeline
  ON canonical_medication_reconciliation_versions(
    tenant_id, reconciliation_public_id, version_number, version_public_id
  );
CREATE INDEX IF NOT EXISTS idx_canonical_med_reconciliation_versions_status
  ON canonical_medication_reconciliation_versions(
    tenant_id, version_status, finalized_at_utc, version_public_id
  );

CREATE TABLE IF NOT EXISTS canonical_medication_reconciliation_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  item_public_id TEXT NOT NULL,
  reconciliation_public_id TEXT NOT NULL,
  version_public_id TEXT NOT NULL,
  item_sequence INTEGER NOT NULL,
  source_kind TEXT NOT NULL,
  decision_code TEXT NOT NULL,
  prescription_public_id TEXT,
  prescription_version_public_id TEXT,
  medication_order_public_id TEXT,
  medication_description_snapshot TEXT NOT NULL,
  prior_dose_snapshot TEXT,
  prior_route_snapshot TEXT,
  prior_frequency_snapshot TEXT,
  proposed_dose_snapshot TEXT,
  proposed_route_snapshot TEXT,
  proposed_frequency_snapshot TEXT,
  reason_code TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_med_reconciliation_item_sequence_check CHECK (item_sequence > 0),
  CONSTRAINT canonical_med_reconciliation_item_source_check CHECK (
    source_kind IN ('home','inpatient','new','unknown')
  ),
  CONSTRAINT canonical_med_reconciliation_item_decision_check CHECK (
    decision_code IN ('continue','modify','discontinue','add')
  ),
  CONSTRAINT canonical_med_reconciliation_item_prescription_pair_check CHECK (
    (prescription_public_id IS NULL AND prescription_version_public_id IS NULL)
    OR (prescription_public_id IS NOT NULL AND prescription_version_public_id IS NOT NULL)
  ),
  CONSTRAINT canonical_med_reconciliation_item_description_check CHECK (
    length(trim(medication_description_snapshot)) > 0
  ),
  CONSTRAINT canonical_med_reconciliation_item_reason_check CHECK (
    length(trim(reason_code)) > 0
  ),
  CONSTRAINT canonical_med_reconciliation_item_proposal_check CHECK (
    decision_code NOT IN ('modify','add')
    OR (
      proposed_dose_snapshot IS NOT NULL
      OR proposed_route_snapshot IS NOT NULL
      OR proposed_frequency_snapshot IS NOT NULL
    )
  ),
  CONSTRAINT canonical_med_reconciliation_item_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT canonical_med_reconciliation_item_time_check CHECK (substr(created_at_utc, -1) = 'Z'),
  FOREIGN KEY (tenant_id, reconciliation_public_id, version_public_id)
    REFERENCES canonical_medication_reconciliation_versions(
      tenant_id, reconciliation_public_id, version_public_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, prescription_public_id, prescription_version_public_id)
    REFERENCES canonical_prescription_versions(
      tenant_id, prescription_public_id, version_public_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, medication_order_public_id)
    REFERENCES canonical_medication_orders(tenant_id, medication_order_public_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, item_public_id),
  UNIQUE (tenant_id, reconciliation_public_id, version_public_id, item_sequence)
);

CREATE INDEX IF NOT EXISTS idx_canonical_med_reconciliation_items_version
  ON canonical_medication_reconciliation_items(
    tenant_id, reconciliation_public_id, version_public_id, item_sequence
  );
CREATE INDEX IF NOT EXISTS idx_canonical_med_reconciliation_items_order
  ON canonical_medication_reconciliation_items(
    tenant_id, medication_order_public_id, reconciliation_public_id, version_public_id
  );

CREATE TRIGGER IF NOT EXISTS trg_canonical_med_reconciliation_item_draft_insert
BEFORE INSERT ON canonical_medication_reconciliation_items
WHEN NOT EXISTS (
  SELECT 1 FROM canonical_medication_reconciliation_versions v
  WHERE v.tenant_id = NEW.tenant_id
    AND v.reconciliation_public_id = NEW.reconciliation_public_id
    AND v.version_public_id = NEW.version_public_id
    AND v.version_status = 'draft'
)
BEGIN
  SELECT RAISE(ABORT, 'canonical medication reconciliation items require a draft version');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_med_reconciliation_item_order_scope
BEFORE INSERT ON canonical_medication_reconciliation_items
WHEN NEW.medication_order_public_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM canonical_medication_orders o
    WHERE o.tenant_id = NEW.tenant_id
      AND o.medication_order_public_id = NEW.medication_order_public_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM canonical_medication_orders o
    JOIN canonical_medication_reconciliations r
      ON r.tenant_id = NEW.tenant_id
     AND r.reconciliation_public_id = NEW.reconciliation_public_id
     AND r.patient_link_public_id = o.patient_link_public_id
     AND r.encounter_public_id = o.encounter_public_id
    WHERE o.tenant_id = NEW.tenant_id
      AND o.medication_order_public_id = NEW.medication_order_public_id
  )
BEGIN
  SELECT RAISE(ABORT, 'canonical medication reconciliation order scope mismatch');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_med_reconciliation_item_immutable_update
BEFORE UPDATE ON canonical_medication_reconciliation_items
BEGIN
  SELECT RAISE(ABORT, 'canonical medication reconciliation item history is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_med_reconciliation_item_immutable_delete
BEFORE DELETE ON canonical_medication_reconciliation_items
BEGIN
  SELECT RAISE(ABORT, 'canonical medication reconciliation item history is immutable');
END;

CREATE TABLE IF NOT EXISTS canonical_medication_reconciliation_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  event_public_id TEXT NOT NULL,
  reconciliation_public_id TEXT NOT NULL,
  version_public_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  actor_practitioner_public_id TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  occurred_at_utc TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_med_reconciliation_event_from_check CHECK (
    from_status IS NULL OR from_status IN ('draft','final','cancelled','entered_in_error')
  ),
  CONSTRAINT canonical_med_reconciliation_event_to_check CHECK (
    to_status IN ('draft','final','cancelled','entered_in_error')
  ),
  CONSTRAINT canonical_med_reconciliation_event_version_check CHECK (event_version > 0),
  CONSTRAINT canonical_med_reconciliation_event_type_check CHECK (
    event_type IN (
      'draft_created','draft_replaced','finalized','cancelled','entered_in_error'
    )
  ),
  CONSTRAINT canonical_med_reconciliation_event_reason_check CHECK (
    length(trim(reason_code)) > 0
  ),
  CONSTRAINT canonical_med_reconciliation_event_actor_check CHECK (
    actor_practitioner_public_id IS NOT NULL
    OR actor_user_public_id IS NOT NULL
    OR actor_system_key IS NOT NULL
  ),
  CONSTRAINT canonical_med_reconciliation_event_time_check CHECK (
    substr(occurred_at_utc, -1) = 'Z' AND substr(created_at_utc, -1) = 'Z'
  ),
  CONSTRAINT canonical_med_reconciliation_event_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  FOREIGN KEY (tenant_id, reconciliation_public_id)
    REFERENCES canonical_medication_reconciliations(tenant_id, reconciliation_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, reconciliation_public_id, version_public_id)
    REFERENCES canonical_medication_reconciliation_versions(
      tenant_id, reconciliation_public_id, version_public_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, actor_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, event_public_id),
  UNIQUE (tenant_id, reconciliation_public_id, event_version)
);

CREATE INDEX IF NOT EXISTS idx_canonical_med_reconciliation_events_timeline
  ON canonical_medication_reconciliation_status_events(
    tenant_id, reconciliation_public_id, event_version, occurred_at_utc
  );

CREATE TRIGGER IF NOT EXISTS trg_canonical_med_reconciliation_event_state_guard
BEFORE INSERT ON canonical_medication_reconciliation_status_events
WHEN NOT (
  (
    NEW.event_version = 1
    AND NEW.from_status IS NULL
    AND NEW.to_status = 'draft'
    AND NEW.event_type = 'draft_created'
    AND EXISTS (
      SELECT 1 FROM canonical_medication_reconciliations r
      WHERE r.tenant_id = NEW.tenant_id
        AND r.reconciliation_public_id = NEW.reconciliation_public_id
        AND r.current_status = 'draft'
        AND r.status_version = 1
    )
  )
  OR (
    NEW.event_version > 1
    AND NEW.from_status IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM canonical_medication_reconciliations r
      WHERE r.tenant_id = NEW.tenant_id
        AND r.reconciliation_public_id = NEW.reconciliation_public_id
        AND r.current_status = NEW.from_status
        AND NEW.event_version = r.status_version + 1
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'canonical medication reconciliation status event does not match current state');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_med_reconciliation_event_immutable_update
BEFORE UPDATE ON canonical_medication_reconciliation_status_events
BEGIN
  SELECT RAISE(ABORT, 'canonical medication reconciliation status event history is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_med_reconciliation_event_immutable_delete
BEFORE DELETE ON canonical_medication_reconciliation_status_events
BEGIN
  SELECT RAISE(ABORT, 'canonical medication reconciliation status event history is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_med_reconciliation_version_insert_draft
BEFORE INSERT ON canonical_medication_reconciliation_versions
WHEN NEW.version_status != 'draft'
  OR NEW.signed_content_sha256 IS NOT NULL
  OR NEW.finalizing_practitioner_public_id IS NOT NULL
  OR NEW.finalized_at_utc IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'canonical medication reconciliation version must start as draft');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_med_reconciliation_version_content_immutable
BEFORE UPDATE ON canonical_medication_reconciliation_versions
WHEN
  OLD.tenant_id IS NOT NEW.tenant_id
  OR OLD.version_public_id IS NOT NEW.version_public_id
  OR OLD.reconciliation_public_id IS NOT NEW.reconciliation_public_id
  OR OLD.version_number IS NOT NEW.version_number
  OR OLD.supersedes_version_public_id IS NOT NEW.supersedes_version_public_id
  OR OLD.source_summary_sha256 IS NOT NEW.source_summary_sha256
  OR OLD.content_sha256 IS NOT NEW.content_sha256
  OR OLD.authoring_practitioner_public_id IS NOT NEW.authoring_practitioner_public_id
  OR OLD.actor_user_public_id IS NOT NEW.actor_user_public_id
  OR OLD.actor_system_key IS NOT NEW.actor_system_key
  OR OLD.authored_at_utc IS NOT NEW.authored_at_utc
  OR OLD.source_evidence_sha256 IS NOT NEW.source_evidence_sha256
  OR OLD.created_at_utc IS NOT NEW.created_at_utc
BEGIN
  SELECT RAISE(ABORT, 'canonical medication reconciliation version content is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_med_reconciliation_version_transition_guard
BEFORE UPDATE OF version_status,signed_content_sha256,finalizing_practitioner_public_id,finalized_at_utc
ON canonical_medication_reconciliation_versions
WHEN NOT (
  OLD.version_status = 'draft'
  AND NEW.version_status IN ('final','cancelled','entered_in_error')
  AND EXISTS (
    SELECT 1 FROM canonical_medication_reconciliation_status_events e
    WHERE e.tenant_id = NEW.tenant_id
      AND e.reconciliation_public_id = NEW.reconciliation_public_id
      AND e.version_public_id = NEW.version_public_id
      AND e.from_status = 'draft'
      AND e.to_status = NEW.version_status
  )
  AND (
    NEW.version_status != 'final'
    OR (
      NEW.signed_content_sha256 = NEW.content_sha256
      AND NEW.finalizing_practitioner_public_id IS NOT NULL
      AND NEW.finalized_at_utc IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM canonical_medication_reconciliation_items i
        WHERE i.tenant_id = NEW.tenant_id
          AND i.reconciliation_public_id = NEW.reconciliation_public_id
          AND i.version_public_id = NEW.version_public_id
      )
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'canonical medication reconciliation finalization requires matching status event and content hash');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_med_reconciliation_version_terminal_immutable
BEFORE UPDATE ON canonical_medication_reconciliation_versions
WHEN OLD.version_status != 'draft'
BEGIN
  SELECT RAISE(ABORT, 'canonical medication reconciliation version history is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_med_reconciliation_version_immutable_delete
BEFORE DELETE ON canonical_medication_reconciliation_versions
BEGIN
  SELECT RAISE(ABORT, 'canonical medication reconciliation version history is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_med_reconciliation_status_update_guard
BEFORE UPDATE OF current_status,status_version,current_version_public_id
ON canonical_medication_reconciliations
WHEN NOT (
  (
    OLD.current_version_public_id IS NULL
    AND NEW.current_version_public_id IS NOT NULL
    AND OLD.current_status = 'draft'
    AND NEW.current_status = 'draft'
    AND OLD.status_version = 1
    AND NEW.status_version = 1
    AND EXISTS (
      SELECT 1
      FROM canonical_medication_reconciliation_status_events e
      JOIN canonical_medication_reconciliation_versions v
        ON v.tenant_id = e.tenant_id
       AND v.reconciliation_public_id = e.reconciliation_public_id
       AND v.version_public_id = e.version_public_id
      WHERE e.tenant_id = NEW.tenant_id
        AND e.reconciliation_public_id = NEW.reconciliation_public_id
        AND e.event_version = 1
        AND e.from_status IS NULL
        AND e.to_status = 'draft'
        AND e.event_type = 'draft_created'
        AND e.version_public_id = NEW.current_version_public_id
        AND v.version_status = 'draft'
    )
  )
  OR EXISTS (
    SELECT 1
    FROM canonical_medication_reconciliation_status_events e
    JOIN canonical_medication_reconciliation_versions v
      ON v.tenant_id = e.tenant_id
     AND v.reconciliation_public_id = e.reconciliation_public_id
     AND v.version_public_id = e.version_public_id
    WHERE e.tenant_id = NEW.tenant_id
      AND e.reconciliation_public_id = NEW.reconciliation_public_id
      AND e.event_version = NEW.status_version
      AND e.from_status = OLD.current_status
      AND e.to_status = NEW.current_status
      AND e.version_public_id = NEW.current_version_public_id
      AND v.version_status = NEW.current_status
  )
)
BEGIN
  SELECT RAISE(ABORT, 'canonical medication reconciliation status transition requires matching status event and version');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_med_reconciliation_status_sequence_guard
BEFORE UPDATE OF current_status,status_version,current_version_public_id
ON canonical_medication_reconciliations
WHEN NOT (
  (
    OLD.current_version_public_id IS NULL
    AND NEW.current_version_public_id IS NOT NULL
    AND OLD.current_status = 'draft'
    AND NEW.current_status = 'draft'
    AND OLD.status_version = 1
    AND NEW.status_version = 1
  )
  OR (
    NEW.status_version = OLD.status_version + 1
    AND (
      (OLD.current_status = 'draft' AND NEW.current_status IN ('draft','final','cancelled','entered_in_error'))
      OR (OLD.current_status = 'final' AND NEW.current_status IN ('cancelled','entered_in_error'))
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid canonical medication reconciliation status transition');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_med_reconciliation_immutable_fields
BEFORE UPDATE ON canonical_medication_reconciliations
WHEN
  OLD.tenant_id IS NOT NEW.tenant_id
  OR OLD.reconciliation_public_id IS NOT NEW.reconciliation_public_id
  OR OLD.patient_link_public_id IS NOT NEW.patient_link_public_id
  OR OLD.encounter_public_id IS NOT NEW.encounter_public_id
  OR OLD.reconciliation_type IS NOT NEW.reconciliation_type
  OR OLD.creating_practitioner_public_id IS NOT NEW.creating_practitioner_public_id
  OR OLD.actor_user_public_id IS NOT NEW.actor_user_public_id
  OR OLD.actor_system_key IS NOT NEW.actor_system_key
  OR OLD.idempotency_key IS NOT NEW.idempotency_key
  OR OLD.request_fingerprint_sha256 IS NOT NEW.request_fingerprint_sha256
  OR OLD.source_evidence_sha256 IS NOT NEW.source_evidence_sha256
  OR OLD.created_at_utc IS NOT NEW.created_at_utc
BEGIN
  SELECT RAISE(ABORT, 'canonical medication reconciliation fact fields are immutable');
END;
