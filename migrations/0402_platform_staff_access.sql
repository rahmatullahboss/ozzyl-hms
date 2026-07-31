-- Platform staff accounts and tenant-scoped support grants.
-- Keep Ozzyl internal staff separate from hospital tenant users so support
-- access can be granted, expired, revoked, and audited without sharing
-- super_admin credentials or adding internal staff to a client hospital.

CREATE TABLE IF NOT EXISTS platform_staff_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('platform_admin','platform_setup','platform_support','platform_auditor')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  last_login_at DATETIME,
  created_by TEXT,
  updated_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_staff_accounts_email_lower
  ON platform_staff_accounts(lower(email));

CREATE INDEX IF NOT EXISTS idx_platform_staff_accounts_role_active
  ON platform_staff_accounts(role, is_active);

CREATE TABLE IF NOT EXISTS platform_staff_tenant_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES platform_staff_accounts(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL,
  grant_type TEXT NOT NULL DEFAULT 'impersonate' CHECK(grant_type IN ('impersonate')),
  allowed_role TEXT NOT NULL CHECK(allowed_role IN ('hospital_admin','doctor','nurse','laboratory','reception','manager','md','director','pharmacist','accountant')),
  reason TEXT NOT NULL,
  expires_at DATETIME,
  revoked_at DATETIME,
  created_by TEXT,
  updated_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_platform_staff_tenant_grants_staff_tenant
  ON platform_staff_tenant_grants(staff_id, tenant_id, grant_type, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_platform_staff_tenant_grants_tenant
  ON platform_staff_tenant_grants(tenant_id, grant_type, revoked_at, expires_at);
