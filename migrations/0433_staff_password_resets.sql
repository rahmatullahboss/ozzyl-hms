-- One-time, tenant-scoped password reset tokens for hospital staff accounts.
CREATE TABLE IF NOT EXISTS staff_password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_staff_password_resets_token
  ON staff_password_resets(token_hash, used_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_staff_password_resets_user_active
  ON staff_password_resets(tenant_id, user_id, used_at, expires_at);
