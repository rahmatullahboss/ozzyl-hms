-- Forward-only repair for environments where historical migration 0085
-- partially landed: users.mfa_enabled exists, but mfa_registrations does not.
-- The existing users.mfa_enabled column is intentionally left untouched.

CREATE TABLE IF NOT EXISTS mfa_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  mfa_type TEXT NOT NULL DEFAULT 'totp' CHECK (mfa_type IN ('totp', 'u2f')),
  secret TEXT NOT NULL,
  is_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  recovery_codes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_user
  ON mfa_registrations(tenant_id, user_id, mfa_type);

CREATE INDEX IF NOT EXISTS idx_mfa_tenant
  ON mfa_registrations(tenant_id);
