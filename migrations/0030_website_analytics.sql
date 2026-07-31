-- Website Analytics: Pageview tracking
-- Migration: 0030_website_analytics.sql

CREATE TABLE IF NOT EXISTS website_pageviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  page TEXT NOT NULL,
  referrer TEXT,
  user_agent TEXT,
  viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_wpv_tenant_date ON website_pageviews(tenant_id, viewed_at);
CREATE INDEX IF NOT EXISTS idx_wpv_page ON website_pageviews(tenant_id, page);
