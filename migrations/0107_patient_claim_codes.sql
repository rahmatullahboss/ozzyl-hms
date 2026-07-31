-- One-time printable claim codes for hospital-issued, unclaimed global identities.

CREATE TABLE IF NOT EXISTS patient_claim_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identity_id INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  code_last4 TEXT NOT NULL,
  issued_by_tenant_id TEXT,
  issued_for_patient_id INTEGER,
  issued_by_user_id INTEGER,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_patient_claim_codes_identity
  ON patient_claim_codes(identity_id, used_at);

CREATE INDEX IF NOT EXISTS idx_patient_claim_codes_expires
  ON patient_claim_codes(expires_at);
