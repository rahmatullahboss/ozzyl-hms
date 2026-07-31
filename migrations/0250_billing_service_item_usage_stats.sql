-- Cached usage counters for billing service catalog ordering.
-- Keeps reception/search reads cheap by avoiding repeated scans of visit_services.

CREATE TABLE IF NOT EXISTS billing_service_item_usage_stats (
  tenant_id INTEGER NOT NULL,
  service_item_id INTEGER NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, service_item_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_service_item_usage_rank
  ON billing_service_item_usage_stats(tenant_id, usage_count DESC, last_used_at DESC);

INSERT INTO billing_service_item_usage_stats
  (tenant_id, service_item_id, usage_count, last_used_at, created_at, updated_at)
SELECT
  tenant_id,
  service_item_id,
  COUNT(*) AS usage_count,
  MAX(created_at) AS last_used_at,
  datetime('now', '+6 hours'),
  datetime('now', '+6 hours')
FROM visit_services
WHERE service_item_id IS NOT NULL
  AND COALESCE(status, '') != 'cancelled'
GROUP BY tenant_id, service_item_id
ON CONFLICT(tenant_id, service_item_id) DO UPDATE SET
  usage_count = excluded.usage_count,
  last_used_at = excluded.last_used_at,
  updated_at = datetime('now', '+6 hours');
