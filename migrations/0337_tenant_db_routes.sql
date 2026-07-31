-- Shard-ready tenant database routing registry.
-- Existing tenants stay on the default DB binding until moved to a shard.

CREATE TABLE IF NOT EXISTS tenant_db_routes (
  tenant_id TEXT PRIMARY KEY,
  shard_key TEXT NOT NULL DEFAULT 'main',
  db_binding TEXT NOT NULL DEFAULT 'DB',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'migrating', 'readonly', 'disabled')),
  migration_started_at DATETIME,
  migrated_at DATETIME,
  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tenant_db_routes_binding
  ON tenant_db_routes(db_binding, status);

CREATE INDEX IF NOT EXISTS idx_tenant_db_routes_shard
  ON tenant_db_routes(shard_key, status);

INSERT OR IGNORE INTO tenant_db_routes (tenant_id, shard_key, db_binding, status)
SELECT id, 'main', 'DB', 'active'
FROM tenants
WHERE id IS NOT NULL;
