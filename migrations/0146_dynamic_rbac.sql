-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0146: Dynamic RBAC — Custom Roles, Per-User Permission Overrides
-- Allows hospital admins to customize permissions per role and per user.
-- Static defaults in authz.ts remain as fallback when no DB override exists.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Role-level permission overrides (per tenant)
-- When a row exists, it REPLACES the static defaults for that role in that tenant.
CREATE TABLE IF NOT EXISTS role_permission_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  role TEXT NOT NULL,
  permissions TEXT NOT NULL,           -- JSON array of permission strings
  updated_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, role)
);
CREATE INDEX IF NOT EXISTS idx_rpo_tenant ON role_permission_overrides(tenant_id);

-- Per-user permission overrides (grant/revoke individual permissions)
-- These are ADDITIVE (grant) or SUBTRACTIVE (revoke) on top of the role permissions.
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  permission TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'grant', -- 'grant' or 'revoke'
  granted_by INTEGER,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, user_id, permission)
);
CREATE INDEX IF NOT EXISTS idx_upo_user ON user_permission_overrides(tenant_id, user_id);

-- Module visibility per role (admin can show/hide sidebar modules)
CREATE TABLE IF NOT EXISTS role_module_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  role TEXT NOT NULL,
  module TEXT NOT NULL,                -- 'patients', 'pharmacy', 'lab', 'billing', 'hr', 'inventory', 'nursing', 'radiology', 'accounting', 'telemedicine', 'reports', 'settings'
  is_visible INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, role, module)
);
CREATE INDEX IF NOT EXISTS idx_rma_tenant ON role_module_access(tenant_id, role);

-- Audit log enhancement: add old_value/new_value for field-level tracking
ALTER TABLE audit_logs ADD COLUMN old_value TEXT;
ALTER TABLE audit_logs ADD COLUMN new_value TEXT;
ALTER TABLE audit_logs ADD COLUMN field_name TEXT;
ALTER TABLE audit_logs ADD COLUMN ip_address TEXT;
ALTER TABLE audit_logs ADD COLUMN user_agent TEXT;
