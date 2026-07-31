-- Per-hospital visibility overrides for shared/default billing service items.
-- Default catalog rows use tenant_id = '0'. Hospitals can hide those defaults
-- without mutating the shared catalog for every tenant.

CREATE TABLE IF NOT EXISTS billing_service_item_tenant_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  global_service_item_id INTEGER NOT NULL REFERENCES billing_service_items(id),
  is_hidden INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_service_item_tenant_override_unique
  ON billing_service_item_tenant_overrides(tenant_id, global_service_item_id);

CREATE INDEX IF NOT EXISTS idx_billing_service_item_tenant_override_hidden
  ON billing_service_item_tenant_overrides(tenant_id, is_hidden);
