CREATE TABLE IF NOT EXISTS patient_visit_passes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL UNIQUE,
  code_last4 TEXT NOT NULL,
  global_user_id INTEGER NOT NULL,
  uhid TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  redeemed_at TEXT,
  redeemed_by_tenant_id TEXT,
  redeemed_by_user_id INTEGER,
  revoked_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_visit_pass_global_user
  ON patient_visit_passes(global_user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_visit_pass_uhid
  ON patient_visit_passes(uhid, is_active);
