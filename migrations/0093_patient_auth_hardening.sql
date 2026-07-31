-- =============================================================================
-- HMS Migration 0093: Patient Auth Hardening
-- Adds email verification, audit logging, and password reset support
-- =============================================================================

-- ─── Audit table for global patient auth events ───────────────────────────
CREATE TABLE IF NOT EXISTS patient_auth_audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  global_user_id INTEGER,
  action        TEXT NOT NULL,  -- register, login, login_failed, google_login, password_reset_request, password_reset, token_refresh
  ip_address    TEXT,
  user_agent    TEXT,
  metadata      TEXT,           -- JSON with extra details
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_paa_user ON patient_auth_audit(global_user_id);
CREATE INDEX IF NOT EXISTS idx_paa_action ON patient_auth_audit(action);
CREATE INDEX IF NOT EXISTS idx_paa_created ON patient_auth_audit(created_at);

-- ─── Add email_verified to global_patient_auth ────────────────────────────
-- Default 0 (unverified) for new registrations; existing accounts get 1
ALTER TABLE global_patient_auth ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1;

-- ─── Password reset tokens ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_password_resets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  global_user_id INTEGER NOT NULL,
  token_hash    TEXT NOT NULL,
  expires_at    DATETIME NOT NULL,
  used          INTEGER NOT NULL DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ppr_user ON patient_password_resets(global_user_id);
CREATE INDEX IF NOT EXISTS idx_ppr_hash ON patient_password_resets(token_hash);
