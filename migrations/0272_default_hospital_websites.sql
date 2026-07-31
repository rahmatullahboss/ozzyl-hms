-- Backfill default public websites for existing active hospitals.
INSERT OR IGNORE INTO website_config (
  tenant_id,
  is_enabled,
  theme,
  seo_title,
  seo_description,
  primary_color,
  secondary_color,
  created_at,
  updated_at
)
SELECT
  id,
  1,
  'arogyaseva',
  name,
  name || ' — Your trusted healthcare partner',
  '#0891b2',
  '#059669',
  datetime('now'),
  datetime('now')
FROM tenants
WHERE status = 'active';
