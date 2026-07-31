-- Migration: Sprint 5 — Custom domains, accessibility metadata
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Custom domain support for tenants
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE tenants ADD COLUMN custom_domain TEXT;
ALTER TABLE tenants ADD COLUMN custom_domain_verified INTEGER DEFAULT 0;
ALTER TABLE tenants ADD COLUMN domain_verification_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_custom_domain ON tenants(custom_domain);
