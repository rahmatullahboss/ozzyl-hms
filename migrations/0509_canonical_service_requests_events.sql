-- =============================================================================
-- HMS Canonical Service Requests and Events (D1 / SQLite)
-- Request means ordered/planned work. Event means operationally accepted or
-- delivered work. Legacy operational sources remain unchanged until cutover.
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_service_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  request_public_id TEXT NOT NULL,
  legacy_patient_id INTEGER NOT NULL,
  encounter_public_id TEXT,
  service_public_id TEXT NOT NULL,
  requested_quantity INTEGER NOT NULL DEFAULT 1,
  fulfilled_quantity INTEGER NOT NULL DEFAULT 0,
  last_event_public_id TEXT,
  status TEXT NOT NULL,
  requested_at_utc TEXT NOT NULL,
  cancelled_at_utc TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (requested_quantity > 0),
  CHECK (fulfilled_quantity >= 0 AND fulfilled_quantity <= requested_quantity),
  CHECK (status IN ('planned','active','partially_fulfilled','fulfilled','cancelled','unknown')),
  CHECK (substr(requested_at_utc, -1) = 'Z'),
  CHECK (cancelled_at_utc IS NULL OR substr(cancelled_at_utc, -1) = 'Z'),
  CHECK (status = 'cancelled' OR cancelled_at_utc IS NULL),
  CHECK (length(source_evidence_sha256) = 64),
  FOREIGN KEY (tenant_id, encounter_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, service_public_id)
    REFERENCES canonical_service_catalog_items(tenant_id, service_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, request_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_service_requests_encounter
  ON canonical_service_requests(tenant_id, encounter_public_id, requested_at_utc, request_public_id);
CREATE INDEX IF NOT EXISTS idx_canonical_service_requests_service_status
  ON canonical_service_requests(tenant_id, service_public_id, status, requested_at_utc);

CREATE TABLE IF NOT EXISTS canonical_service_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  event_public_id TEXT NOT NULL,
  request_public_id TEXT,
  encounter_public_id TEXT,
  service_public_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'posted',
  occurred_at_utc TEXT NOT NULL,
  cancelled_at_utc TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (event_type IN ('accepted','delivered','completed','dispensed','occupied','cancelled','reversed')),
  CHECK (quantity > 0),
  CHECK (status IN ('posted','cancelled','reversed')),
  CHECK (substr(occurred_at_utc, -1) = 'Z'),
  CHECK (cancelled_at_utc IS NULL OR substr(cancelled_at_utc, -1) = 'Z'),
  CHECK (status = 'posted' OR cancelled_at_utc IS NOT NULL),
  CHECK (length(source_evidence_sha256) = 64),
  FOREIGN KEY (tenant_id, request_public_id)
    REFERENCES canonical_service_requests(tenant_id, request_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, encounter_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, service_public_id)
    REFERENCES canonical_service_catalog_items(tenant_id, service_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, event_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_service_events_request
  ON canonical_service_events(tenant_id, request_public_id, occurred_at_utc, event_public_id);
CREATE INDEX IF NOT EXISTS idx_canonical_service_events_service_time
  ON canonical_service_events(tenant_id, service_public_id, event_type, occurred_at_utc);
CREATE INDEX IF NOT EXISTS idx_canonical_service_events_encounter
  ON canonical_service_events(tenant_id, encounter_public_id, occurred_at_utc);

CREATE TABLE IF NOT EXISTS canonical_service_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  request_public_id TEXT,
  event_public_id TEXT,
  practitioner_public_id TEXT NOT NULL,
  participant_role TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((request_public_id IS NOT NULL) <> (event_public_id IS NOT NULL)),
  CHECK (participant_role IN ('ordering','prescribing','performing','reporting','approving','referring')),
  CHECK (evidence_type IN (
    'legacy_lab_orderer','legacy_lab_processor','legacy_lab_verifier',
    'legacy_radiology_prescriber','legacy_radiology_performer',
    'legacy_consultation_doctor','legacy_procedure_orderer',
    'legacy_procedure_performer','legacy_prescription_doctor','approved_manual'
  )),
  FOREIGN KEY (tenant_id, request_public_id)
    REFERENCES canonical_service_requests(tenant_id, request_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, event_public_id)
    REFERENCES canonical_service_events(tenant_id, event_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id) ON DELETE RESTRICT,
  UNIQUE (
    tenant_id, request_public_id, event_public_id,
    practitioner_public_id, participant_role, evidence_type
  )
);

CREATE INDEX IF NOT EXISTS idx_canonical_service_participants_practitioner
  ON canonical_service_participants(
    tenant_id, practitioner_public_id, participant_role,
    request_public_id, event_public_id
  );
