-- Cloud-to-local tenant snapshot sync state.

CREATE TABLE IF NOT EXISTS local_cloud_pull_state (
  tenant_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  last_snapshot_id TEXT,
  last_pulled_at DATETIME,
  rows_received INTEGER NOT NULL DEFAULT 0,
  rows_applied INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'applied', 'failed', 'skipped')),
  last_error TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, table_name)
);

CREATE TABLE IF NOT EXISTS local_cloud_pull_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  snapshot_id TEXT,
  table_name TEXT,
  event TEXT NOT NULL CHECK(event IN ('started', 'applied', 'failed', 'skipped')),
  rows_received INTEGER NOT NULL DEFAULT 0,
  rows_applied INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_local_cloud_pull_log_tenant_created
  ON local_cloud_pull_log(tenant_id, created_at);
