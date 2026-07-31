-- Migration: 0085_mfa_totp.sql
-- Multi-Factor Authentication (TOTP)

CREATE TABLE IF NOT EXISTS mfa_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    mfa_type TEXT NOT NULL DEFAULT 'totp' CHECK(mfa_type IN ('totp','u2f')),
    secret TEXT NOT NULL,                 -- base32 encoded TOTP secret
    is_verified INTEGER DEFAULT 0,        -- 1 after first successful verification
    is_active INTEGER DEFAULT 1,
    recovery_codes TEXT,                  -- JSON array of one-time recovery codes
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_user ON mfa_registrations(tenant_id, user_id, mfa_type);
CREATE INDEX IF NOT EXISTS idx_mfa_tenant ON mfa_registrations(tenant_id);

-- Track MFA-related settings per user
ALTER TABLE users ADD COLUMN mfa_enabled INTEGER DEFAULT 0;
