-- Migration 0416: Tenant-scoped executive dashboard KPI presentation settings.
-- Metrics and formulas remain server-whitelisted; tenants may only control visibility,
-- ordering, and a bounded display-label override.

CREATE TABLE IF NOT EXISTS dashboard_kpi_config (
  tenant_id TEXT NOT NULL,
  dashboard_key TEXT NOT NULL DEFAULT 'executive',
  metric_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0 AND position <= 100),
  label_override TEXT CHECK (label_override IS NULL OR length(label_override) <= 60),
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  PRIMARY KEY (tenant_id, dashboard_key, metric_key)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_kpi_config_order
  ON dashboard_kpi_config (tenant_id, dashboard_key, enabled, position, metric_key);
