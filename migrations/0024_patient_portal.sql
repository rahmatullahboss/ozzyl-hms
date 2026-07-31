-- =============================================================================
-- HMS Migration 0024: Patient Portal (credentials + OTP)
-- Applied: 2026-03-13
-- =============================================================================

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────────────────────
-- Add email column to patients table (for portal login)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE patients ADD COLUMN email TEXT;
CREATE INDEX IF NOT EXISTS idx_patients_email ON patients(email, tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- PATIENT CREDENTIALS (portal access)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_credentials (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id    INTEGER NOT NULL,
  email         TEXT    NOT NULL,              -- login identifier
  pin_hash      TEXT,                          -- optional 4-digit PIN for future
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at DATETIME,
  tenant_id     INTEGER NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_patient_cred_email_tenant
  ON patient_credentials(email, tenant_id);
CREATE INDEX IF NOT EXISTS idx_patient_cred_patient
  ON patient_credentials(patient_id, tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- PATIENT OTP CODES (email-based login)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_otp_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL,
  otp_code   TEXT    NOT NULL,
  tenant_id  INTEGER NOT NULL,
  expires_at DATETIME NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_patient_otp_email
  ON patient_otp_codes(email, tenant_id, used);

-- ─────────────────────────────────────────────────────────────────────────────
-- PATIENT PORTAL AUDIT LOG
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_portal_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  action     TEXT    NOT NULL,  -- 'login', 'view_appointments', 'view_bills', etc.
  ip_address TEXT,
  tenant_id  INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_portal_audit_patient
  ON patient_portal_audit(patient_id, tenant_id, created_at);
