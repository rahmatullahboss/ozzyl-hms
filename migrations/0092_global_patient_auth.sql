-- =============================================================================
-- HMS Migration 0092: Global Patient Auth
-- Patient self-service login (email/phone + password, Google Sign-In)
-- Tenant-agnostic — patients log in once, see all linked hospitals
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- GLOBAL PATIENT AUTH (login credentials for patient health portal)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS global_patient_auth (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Link to global_patient_identity (NID → UHID)
  national_id   TEXT,
  uhid          TEXT,
  -- Login identifiers (at least one required)
  email         TEXT,
  phone         TEXT,
  -- Credentials
  password_hash TEXT,        -- bcrypt hash
  -- Google Sign-In (GIS) — only client_id needed, verified via JWKS
  google_sub    TEXT,        -- Google's unique subject ID
  google_email  TEXT,        -- email from Google ID token
  -- Profile
  name          TEXT,
  -- Status
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at DATETIME,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gpa_email ON global_patient_auth(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gpa_phone ON global_patient_auth(phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gpa_google ON global_patient_auth(google_sub) WHERE google_sub IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gpa_nid ON global_patient_auth(national_id) WHERE national_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gpa_uhid ON global_patient_auth(uhid) WHERE uhid IS NOT NULL;
