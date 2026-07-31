
-- Local Server: add schema-sync tracking tables.
-- This migration is a no-op on cloud D1 (where the tables do not belong)
-- and a no-op on fresh local D1s (the tables are already in tenant-schema.sql).
-- It runs only on local D1s that pre-date the schema-sync feature.

CREATE TABLE IF NOT EXISTS local_schema_migrations (
  filename TEXT PRIMARY KEY,
  safety TEXT NOT NULL CHECK(safety IN ('safe', 'destructive')),
  content_hash TEXT NOT NULL,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  duration_ms INTEGER,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS local_schema_sync_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  safety TEXT NOT NULL CHECK(safety IN ('destructive')),
  content_hash TEXT NOT NULL,
  sql_content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'approved', 'rejected', 'applied', 'failed')),
  reviewed_by TEXT,
  reviewed_at DATETIME,
  apply_error TEXT,
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  applied_at DATETIME
);

CREATE TABLE IF NOT EXISTS local_schema_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  event TEXT NOT NULL,
  actor TEXT,
  message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_local_schema_approvals_status
  ON local_schema_sync_approvals(status, detected_at);

CREATE INDEX IF NOT EXISTS idx_local_schema_log_filename
  ON local_schema_sync_log(filename, created_at);
