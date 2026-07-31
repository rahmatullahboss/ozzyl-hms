-- Website Analytics: Add subdomain column for direct tracking (P0 fix: eliminates D1 lookup per pageview)
-- Migration: 0031_website_analytics_subdomain.sql

ALTER TABLE website_pageviews ADD COLUMN subdomain TEXT;

-- Backfill existing rows (if any) from tenants table
UPDATE website_pageviews
SET subdomain = (SELECT subdomain FROM tenants WHERE tenants.id = website_pageviews.tenant_id)
WHERE subdomain IS NULL;

-- Make tenant_id optional since we now use subdomain
-- (SQLite doesn't support ALTER COLUMN, so tenant_id stays but is no longer required for new inserts)
