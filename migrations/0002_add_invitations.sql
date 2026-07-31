-- Migration: Add invitations table for role-based staff onboarding
-- Hospitals can invite staff by email; staff accept via secure token link

CREATE TABLE IF NOT EXISTS invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant')),
  token TEXT NOT NULL UNIQUE,
  invited_by INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (invited_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_tenant ON invitations(tenant_id);
