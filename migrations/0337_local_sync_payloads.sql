-- Add mapper payload support for audited local-to-cloud sync events.

ALTER TABLE local_sync_outbox ADD COLUMN payload_json TEXT;
ALTER TABLE local_sync_outbox ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE cloud_sync_ingest_events ADD COLUMN apply_status TEXT NOT NULL DEFAULT 'metadata_only'
  CHECK(apply_status IN ('metadata_only', 'applied', 'failed'));
ALTER TABLE cloud_sync_ingest_events ADD COLUMN apply_error TEXT;
