-- Local server sync foundation.
-- Stores immutable local outbox metadata and cloud ingest idempotency ledger.

CREATE TABLE IF NOT EXISTS local_sync_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('create', 'update', 'delete', 'upsert')),
  payload_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'exporting', 'exported', 'failed', 'poison')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at DATETIME,
  locked_at DATETIME,
  last_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  exported_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_local_sync_outbox_status_next
  ON local_sync_outbox(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_local_sync_outbox_tenant_entity
  ON local_sync_outbox(tenant_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS cloud_sync_ingest_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('create', 'update', 'delete', 'upsert')),
  payload_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  received_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cloud_sync_ingest_server_batch
  ON cloud_sync_ingest_events(server_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_cloud_sync_ingest_tenant_entity
  ON cloud_sync_ingest_events(tenant_id, entity_type, entity_id);
