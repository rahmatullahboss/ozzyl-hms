-- Password-bound, tenant-scoped MFA login challenges.
CREATE TABLE IF NOT EXISTS mfa_login_challenges (
  challenge_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_mfa_login_challenges_active
  ON mfa_login_challenges(tenant_id, user_id, expires_at)
  WHERE consumed_at IS NULL;
