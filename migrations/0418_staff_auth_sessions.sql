CREATE TABLE IF NOT EXISTS staff_auth_sessions (
  session_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'rotated', 'revoked')),
  expires_at TEXT NOT NULL,
  rotated_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_staff_auth_sessions_active
  ON staff_auth_sessions(tenant_id, user_id, status, expires_at);
