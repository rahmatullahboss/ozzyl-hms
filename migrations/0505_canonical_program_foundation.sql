-- =============================================================================
-- HMS Canonical Data Program Foundation (D1 / SQLite)
-- Additive-only registries for schema versions, migration/backfill execution,
-- deterministic source mapping, outbox processing, issues, reconciliation, and
-- tenant-scoped cutover feature flags.
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_schema_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  migration_name TEXT NOT NULL,
  migration_checksum TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'registered',
  activated_at_utc TEXT,
  retired_at_utc TEXT,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (schema_version > 0),
  CHECK (state IN ('registered', 'shadow', 'active', 'retired')),
  CHECK (activated_at_utc IS NULL OR substr(activated_at_utc, -1) = 'Z'),
  CHECK (retired_at_utc IS NULL OR substr(retired_at_utc, -1) = 'Z')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_schema_versions_domain_version
  ON canonical_schema_versions(tenant_id, domain, schema_version);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_schema_versions_active
  ON canonical_schema_versions(tenant_id, domain)
  WHERE state = 'active';
CREATE INDEX IF NOT EXISTS idx_canonical_schema_versions_state
  ON canonical_schema_versions(tenant_id, domain, state, schema_version);

CREATE TABLE IF NOT EXISTS canonical_migration_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  run_public_id TEXT NOT NULL,
  migration_name TEXT NOT NULL,
  migration_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  source_database_id TEXT,
  source_bookmark TEXT,
  rollback_bookmark TEXT,
  started_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at_utc TEXT,
  result_summary_json TEXT,
  error_code TEXT,
  error_summary TEXT,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (migration_kind IN ('schema', 'backfill', 'reconciliation', 'cutover', 'rollback')),
  CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  CHECK (completed_at_utc IS NULL OR substr(completed_at_utc, -1) = 'Z'),
  CHECK (
    (status IN ('succeeded', 'failed', 'cancelled') AND completed_at_utc IS NOT NULL)
    OR (status IN ('pending', 'running') AND completed_at_utc IS NULL)
  ),
  CHECK (result_summary_json IS NULL OR json_valid(result_summary_json))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_migration_runs_public_id
  ON canonical_migration_runs(tenant_id, run_public_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_migration_runs_tenant_id
  ON canonical_migration_runs(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_canonical_migration_runs_status
  ON canonical_migration_runs(tenant_id, status, started_at_utc);
CREATE INDEX IF NOT EXISTS idx_canonical_migration_runs_name
  ON canonical_migration_runs(tenant_id, migration_name, started_at_utc);

CREATE TABLE IF NOT EXISTS canonical_reconciliation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  run_public_id TEXT NOT NULL,
  migration_run_id INTEGER,
  domain TEXT NOT NULL,
  reconciliation_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  scanned_count INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  mismatch_count INTEGER NOT NULL DEFAULT 0,
  exception_count INTEGER NOT NULL DEFAULT 0,
  expected_total_minor INTEGER,
  actual_total_minor INTEGER,
  variance_minor INTEGER,
  currency_code TEXT,
  evidence_sha256 TEXT,
  result_summary_json TEXT,
  started_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at_utc TEXT,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (reconciliation_type IN ('baseline', 'backfill', 'shadow', 'cutover', 'post_cutover')),
  CHECK (status IN ('pending', 'running', 'passed', 'failed', 'accepted_with_exceptions')),
  CHECK (scanned_count >= 0 AND matched_count >= 0 AND mismatch_count >= 0 AND exception_count >= 0),
  CHECK (matched_count + mismatch_count = scanned_count),
  CHECK (exception_count <= mismatch_count),
  CHECK (
    (expected_total_minor IS NULL AND actual_total_minor IS NULL AND variance_minor IS NULL AND currency_code IS NULL)
    OR (
      expected_total_minor IS NOT NULL AND actual_total_minor IS NOT NULL
      AND variance_minor = actual_total_minor - expected_total_minor
      AND currency_code IS NOT NULL AND length(currency_code) = 3
    )
  ),
  CHECK (completed_at_utc IS NULL OR substr(completed_at_utc, -1) = 'Z'),
  CHECK (
    (status IN ('passed', 'failed', 'accepted_with_exceptions') AND completed_at_utc IS NOT NULL)
    OR (status IN ('pending', 'running') AND completed_at_utc IS NULL)
  ),
  CHECK (result_summary_json IS NULL OR json_valid(result_summary_json)),
  FOREIGN KEY (tenant_id, migration_run_id)
    REFERENCES canonical_migration_runs(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_reconciliation_runs_public_id
  ON canonical_reconciliation_runs(tenant_id, run_public_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_reconciliation_runs_tenant_id
  ON canonical_reconciliation_runs(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_canonical_reconciliation_runs_status
  ON canonical_reconciliation_runs(tenant_id, domain, status, started_at_utc);
CREATE INDEX IF NOT EXISTS idx_canonical_reconciliation_runs_migration
  ON canonical_reconciliation_runs(tenant_id, migration_run_id, started_at_utc);

CREATE TABLE IF NOT EXISTS canonical_backfill_checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  checkpoint_public_id TEXT NOT NULL,
  migration_run_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  partition_key TEXT NOT NULL DEFAULT '',
  cursor_value TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  scanned_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  mapped_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  exception_count INTEGER NOT NULL DEFAULT 0,
  started_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at_utc TEXT,
  last_error_code TEXT,
  last_error_summary TEXT,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed')),
  CHECK (
    scanned_count >= 0 AND created_count >= 0 AND mapped_count >= 0
    AND skipped_count >= 0 AND exception_count >= 0
  ),
  CHECK (completed_at_utc IS NULL OR substr(completed_at_utc, -1) = 'Z'),
  CHECK (
    (status IN ('completed', 'failed') AND completed_at_utc IS NOT NULL)
    OR (status IN ('pending', 'running', 'paused') AND completed_at_utc IS NULL)
  ),
  FOREIGN KEY (tenant_id, migration_run_id)
    REFERENCES canonical_migration_runs(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_backfill_checkpoints_public_id
  ON canonical_backfill_checkpoints(tenant_id, checkpoint_public_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_backfill_checkpoint_scope
  ON canonical_backfill_checkpoints(tenant_id, migration_run_id, entity_type, source_type, partition_key);
CREATE INDEX IF NOT EXISTS idx_canonical_backfill_checkpoints_status
  ON canonical_backfill_checkpoints(tenant_id, migration_run_id, status, updated_at_utc);

CREATE TABLE IF NOT EXISTS canonical_source_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  canonical_public_id TEXT,
  source_type TEXT NOT NULL,
  source_public_id TEXT NOT NULL,
  source_table TEXT NOT NULL,
  mapping_status TEXT NOT NULL DEFAULT 'mapped',
  mapping_version INTEGER NOT NULL DEFAULT 1,
  migration_run_id INTEGER,
  evidence_sha256 TEXT,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (mapping_status IN ('mapped', 'ambiguous', 'rejected', 'retired')),
  CHECK (mapping_version > 0),
  CHECK (
    (mapping_status IN ('mapped', 'retired') AND canonical_public_id IS NOT NULL)
    OR (mapping_status IN ('ambiguous', 'rejected') AND canonical_public_id IS NULL)
  ),
  FOREIGN KEY (tenant_id, migration_run_id)
    REFERENCES canonical_migration_runs(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_source_mapping_source
  ON canonical_source_mappings(tenant_id, entity_type, source_type, source_public_id);
CREATE INDEX IF NOT EXISTS idx_canonical_source_mappings_canonical
  ON canonical_source_mappings(tenant_id, entity_type, canonical_public_id, mapping_status);
CREATE INDEX IF NOT EXISTS idx_canonical_source_mappings_run
  ON canonical_source_mappings(tenant_id, migration_run_id, mapping_status);

CREATE TABLE IF NOT EXISTS canonical_outbox_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  event_public_id TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_public_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  occurred_at_utc TEXT NOT NULL,
  business_date TEXT,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  available_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  processing_attempts INTEGER NOT NULL DEFAULT 0,
  locked_at_utc TEXT,
  locked_by TEXT,
  published_at_utc TEXT,
  last_error_code TEXT,
  last_error_summary TEXT,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (event_version > 0),
  CHECK (json_valid(payload_json)),
  CHECK (occurred_at_utc IS NOT NULL AND substr(occurred_at_utc, -1) = 'Z'),
  CHECK (business_date IS NULL OR business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (status IN ('pending', 'processing', 'published', 'retry', 'dead_letter', 'cancelled')),
  CHECK (processing_attempts >= 0),
  CHECK (locked_at_utc IS NULL OR substr(locked_at_utc, -1) = 'Z'),
  CHECK (published_at_utc IS NULL OR substr(published_at_utc, -1) = 'Z'),
  CHECK (status != 'processing' OR (locked_at_utc IS NOT NULL AND locked_by IS NOT NULL)),
  CHECK (status != 'published' OR published_at_utc IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_outbox_event_public_id
  ON canonical_outbox_events(tenant_id, event_public_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_outbox_idempotency
  ON canonical_outbox_events(tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_canonical_outbox_delivery
  ON canonical_outbox_events(tenant_id, status, available_at_utc, id);
CREATE INDEX IF NOT EXISTS idx_canonical_outbox_aggregate
  ON canonical_outbox_events(tenant_id, aggregate_type, aggregate_public_id, occurred_at_utc);

CREATE TABLE IF NOT EXISTS canonical_processing_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  issue_public_id TEXT NOT NULL,
  migration_run_id INTEGER,
  reconciliation_run_id INTEGER,
  issue_type TEXT NOT NULL,
  issue_code TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_public_id TEXT,
  source_type TEXT,
  source_public_id TEXT,
  fingerprint TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'error',
  status TEXT NOT NULL DEFAULT 'open',
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  summary TEXT NOT NULL,
  details_json TEXT,
  first_seen_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at_utc TEXT,
  resolved_by_public_id TEXT,
  resolution_code TEXT,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  CHECK (status IN ('open', 'acknowledged', 'resolved', 'waived')),
  CHECK (occurrence_count > 0),
  CHECK (details_json IS NULL OR json_valid(details_json)),
  CHECK (resolved_at_utc IS NULL OR substr(resolved_at_utc, -1) = 'Z'),
  CHECK (
    status NOT IN ('resolved', 'waived')
    OR (resolved_at_utc IS NOT NULL AND resolution_code IS NOT NULL)
  ),
  FOREIGN KEY (tenant_id, migration_run_id)
    REFERENCES canonical_migration_runs(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, reconciliation_run_id)
    REFERENCES canonical_reconciliation_runs(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_processing_issues_public_id
  ON canonical_processing_issues(tenant_id, issue_public_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_processing_issues_fingerprint
  ON canonical_processing_issues(tenant_id, issue_type, fingerprint);
CREATE INDEX IF NOT EXISTS idx_canonical_processing_issues_queue
  ON canonical_processing_issues(tenant_id, status, severity, last_seen_at_utc);
CREATE INDEX IF NOT EXISTS idx_canonical_processing_issues_entity
  ON canonical_processing_issues(tenant_id, entity_type, entity_public_id, status);

CREATE TABLE IF NOT EXISTS canonical_feature_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  flag_key TEXT NOT NULL,
  domain TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'legacy',
  is_enabled INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  config_json TEXT,
  effective_at_utc TEXT,
  expires_at_utc TEXT,
  updated_by_public_id TEXT,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (mode IN ('legacy', 'shadow', 'canonical', 'disabled')),
  CHECK (is_enabled IN (0, 1)),
  CHECK (version > 0),
  CHECK (mode != 'disabled' OR is_enabled = 0),
  CHECK (config_json IS NULL OR json_valid(config_json)),
  CHECK (effective_at_utc IS NULL OR substr(effective_at_utc, -1) = 'Z'),
  CHECK (expires_at_utc IS NULL OR substr(expires_at_utc, -1) = 'Z'),
  CHECK (expires_at_utc IS NULL OR effective_at_utc IS NULL OR expires_at_utc >= effective_at_utc)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_feature_flags_key
  ON canonical_feature_flags(tenant_id, flag_key);
CREATE INDEX IF NOT EXISTS idx_canonical_feature_flags_domain
  ON canonical_feature_flags(tenant_id, domain, mode, is_enabled);
