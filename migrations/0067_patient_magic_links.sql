-- Migration: Patient magic link authentication (replaces OTP)
-- Adds patient_magic_links table for audit trail and is_verified flag on patients

CREATE TABLE IF NOT EXISTS patient_magic_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER,
  token_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'login',  -- 'login' | 'registration'
  used INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_magic_links_email_tenant
  ON patient_magic_links (email, tenant_id);

CREATE INDEX IF NOT EXISTS idx_magic_links_token_hash
  ON patient_magic_links (token_hash);

-- Add is_verified flag to patients table (default 1 for existing patients)
ALTER TABLE patients ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 1;
