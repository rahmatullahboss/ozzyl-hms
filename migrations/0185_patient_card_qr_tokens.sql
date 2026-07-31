-- Health card QR tokens for cross-hospital patient lookup/import.
-- QR payloads must not contain PHI; only a one-time-visible opaque token is printed.

CREATE TABLE IF NOT EXISTS patient_card_qr_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  token_last4 TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  uhid TEXT NOT NULL,
  health_card_id INTEGER,
  card_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
  issued_by_user_id INTEGER NOT NULL,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  revoked_by_user_id INTEGER,
  revoke_reason TEXT,
  last_scanned_at TEXT,
  scan_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_patient_card_qr_tokens_patient
  ON patient_card_qr_tokens(tenant_id, patient_id, status);

CREATE INDEX IF NOT EXISTS idx_patient_card_qr_tokens_uhid
  ON patient_card_qr_tokens(uhid, status);

CREATE TABLE IF NOT EXISTS patient_card_qr_scan_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id INTEGER,
  source_tenant_id TEXT,
  source_patient_id INTEGER,
  scanned_by_tenant_id TEXT NOT NULL,
  scanned_by_user_id INTEGER NOT NULL,
  scanned_by_role TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('resolve', 'import')),
  scope TEXT NOT NULL,
  outcome TEXT NOT NULL,
  destination_patient_id INTEGER,
  ip_address TEXT,
  user_agent TEXT,
  scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_patient_card_qr_scan_audit_token
  ON patient_card_qr_scan_audit(token_id, scanned_at);

CREATE INDEX IF NOT EXISTS idx_patient_card_qr_scan_audit_scanner
  ON patient_card_qr_scan_audit(scanned_by_tenant_id, scanned_by_user_id, scanned_at);
