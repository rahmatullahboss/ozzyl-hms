-- CDB-110B: additive canonical local-sync protocol persistence.
-- This migration does not activate synchronization or connect any runtime route.

CREATE TABLE IF NOT EXISTS canonical_sync_inbox_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL CHECK (length(trim(tenant_id)) BETWEEN 1 AND 128),
  inbox_public_id TEXT NOT NULL CHECK (
    length(trim(inbox_public_id)) BETWEEN 1 AND 160
    AND inbox_public_id GLOB '*[^0-9]*'
  ),
  event_public_id TEXT NOT NULL CHECK (
    length(trim(event_public_id)) BETWEEN 1 AND 160
    AND event_public_id GLOB '*[^0-9]*'
  ),
  protocol_version INTEGER NOT NULL DEFAULT 1 CHECK (protocol_version = 1),
  entity_type TEXT NOT NULL CHECK (length(trim(entity_type)) BETWEEN 1 AND 96),
  entity_public_id TEXT NOT NULL CHECK (
    length(trim(entity_public_id)) BETWEEN 1 AND 192
    AND entity_public_id GLOB '*[^0-9]*'
  ),
  event_type TEXT NOT NULL CHECK (length(trim(event_type)) BETWEEN 1 AND 160),
  aggregate_version INTEGER NOT NULL CHECK (aggregate_version >= 1),
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'tombstone')),
  payload_json TEXT NOT NULL CHECK (length(payload_json) >= 2 AND json_valid(payload_json)),
  payload_sha256 TEXT NOT NULL CHECK (
    length(payload_sha256) = 64
    AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  idempotency_key TEXT NOT NULL CHECK (
    length(idempotency_key) = 64
    AND idempotency_key NOT GLOB '*[^0-9a-f]*'
  ),
  source_node_public_id TEXT NOT NULL CHECK (
    length(trim(source_node_public_id)) BETWEEN 1 AND 192
    AND source_node_public_id GLOB '*[^0-9]*'
  ),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'applying', 'applied', 'conflict', 'retry', 'dead_letter')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  received_at_utc TEXT NOT NULL CHECK (
    length(trim(received_at_utc)) >= 20 AND substr(received_at_utc, -1) = 'Z'
  ),
  applied_at_utc TEXT CHECK (applied_at_utc IS NULL OR substr(applied_at_utc, -1) = 'Z'),
  updated_at_utc TEXT NOT NULL CHECK (
    length(trim(updated_at_utc)) >= 20 AND substr(updated_at_utc, -1) = 'Z'
  ),
  error_code TEXT CHECK (error_code IS NULL OR length(trim(error_code)) BETWEEN 1 AND 96),
  error_hash TEXT CHECK (
    error_hash IS NULL
    OR (
      length(error_hash) = 64
      AND error_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  UNIQUE (tenant_id, inbox_public_id),
  UNIQUE (tenant_id, event_public_id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (
    (status = 'applied' AND applied_at_utc IS NOT NULL)
    OR (status <> 'applied')
  )
);

CREATE TABLE IF NOT EXISTS canonical_sync_inbox_dependencies (
  tenant_id TEXT NOT NULL CHECK (length(trim(tenant_id)) BETWEEN 1 AND 128),
  inbox_event_public_id TEXT NOT NULL CHECK (length(trim(inbox_event_public_id)) BETWEEN 1 AND 160),
  dependency_entity_type TEXT NOT NULL CHECK (length(trim(dependency_entity_type)) BETWEEN 1 AND 96),
  dependency_entity_public_id TEXT NOT NULL CHECK (
    length(trim(dependency_entity_public_id)) BETWEEN 1 AND 192
    AND dependency_entity_public_id GLOB '*[^0-9]*'
  ),
  minimum_version INTEGER NOT NULL CHECK (minimum_version >= 1),
  PRIMARY KEY (
    tenant_id,
    inbox_event_public_id,
    dependency_entity_type,
    dependency_entity_public_id
  ),
  FOREIGN KEY (tenant_id, inbox_event_public_id)
    REFERENCES canonical_sync_inbox_events (tenant_id, event_public_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS canonical_sync_entity_versions (
  tenant_id TEXT NOT NULL CHECK (length(trim(tenant_id)) BETWEEN 1 AND 128),
  entity_type TEXT NOT NULL CHECK (length(trim(entity_type)) BETWEEN 1 AND 96),
  entity_public_id TEXT NOT NULL CHECK (
    length(trim(entity_public_id)) BETWEEN 1 AND 192
    AND entity_public_id GLOB '*[^0-9]*'
  ),
  applied_version INTEGER NOT NULL DEFAULT 0 CHECK (applied_version >= 0),
  last_event_public_id TEXT CHECK (
    last_event_public_id IS NULL
    OR (
      length(trim(last_event_public_id)) BETWEEN 1 AND 160
      AND last_event_public_id GLOB '*[^0-9]*'
    )
  ),
  last_operation TEXT CHECK (
    last_operation IS NULL OR last_operation IN ('upsert', 'tombstone')
  ),
  last_payload_sha256 TEXT CHECK (
    last_payload_sha256 IS NULL
    OR (
      length(last_payload_sha256) = 64
      AND last_payload_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  updated_at_utc TEXT NOT NULL CHECK (
    length(trim(updated_at_utc)) >= 20 AND substr(updated_at_utc, -1) = 'Z'
  ),
  PRIMARY KEY (tenant_id, entity_type, entity_public_id),
  CHECK (
    (applied_version = 0
      AND last_event_public_id IS NULL
      AND last_operation IS NULL
      AND last_payload_sha256 IS NULL)
    OR
    (applied_version >= 1
      AND last_event_public_id IS NOT NULL
      AND last_operation IS NOT NULL
      AND last_payload_sha256 IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_canonical_sync_inbox_pending
  ON canonical_sync_inbox_events (tenant_id, status, received_at_utc, event_public_id);

CREATE INDEX IF NOT EXISTS idx_canonical_sync_dependency_lookup
  ON canonical_sync_inbox_dependencies (
    tenant_id,
    dependency_entity_type,
    dependency_entity_public_id,
    minimum_version
  );
