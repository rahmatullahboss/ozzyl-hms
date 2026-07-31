-- ════════════════════════════════════════════════════════════════
-- Sprint 7: Cross-Hospital Portable Health Record System
-- Created: 2026-04-06
-- ════════════════════════════════════════════════════════════════

-- ── 1. Add National ID to patients ──────────────────────────────

ALTER TABLE patients ADD COLUMN national_id TEXT;

-- Global NID lookup index (cross-tenant MPI queries)
CREATE INDEX IF NOT EXISTS idx_patients_national_id
  ON patients(national_id);

-- Enforce one NID per tenant (a patient can't register twice at same hospital with same NID)
CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_nid_tenant
  ON patients(national_id, tenant_id)
  WHERE national_id IS NOT NULL;

-- ── 2. Master Patient Index (cross-tenant bridge) ───────────────
-- This table intentionally reads WITHOUT tenant_id filter —
-- it is the only cross-tenant bridge in the system.

CREATE TABLE IF NOT EXISTS patient_health_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  national_id TEXT NOT NULL,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  hospital_name TEXT,
  linked_at TEXT DEFAULT (datetime('now')),
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(national_id, tenant_id, patient_id)
);

CREATE INDEX IF NOT EXISTS idx_health_links_nid
  ON patient_health_links(national_id);

CREATE INDEX IF NOT EXISTS idx_health_links_patient
  ON patient_health_links(tenant_id, patient_id);

-- ── 3. Health Record Consents ───────────────────────────────────
-- Patient must grant consent before any cross-hospital data sharing.
-- granted_to_tenant_id = NULL means consent for ANY hospital.

CREATE TABLE IF NOT EXISTS health_record_consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  national_id TEXT NOT NULL,
  granting_tenant_id INTEGER NOT NULL,
  granting_patient_id INTEGER NOT NULL,
  granted_to_tenant_id INTEGER,
  consent_type TEXT NOT NULL CHECK(consent_type IN ('view_summary', 'view_full', 'emergency_access')),
  is_active INTEGER NOT NULL DEFAULT 1,
  granted_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_consents_nid
  ON health_record_consents(national_id, is_active);

CREATE INDEX IF NOT EXISTS idx_consents_granting
  ON health_record_consents(granting_tenant_id, granting_patient_id);

-- ── 4. Health Record Access Tokens ──────────────────────────────
-- Short-lived tokens for QR code / link-based health record access.
-- Only the SHA-256 hash is stored; raw token returned once on creation.

CREATE TABLE IF NOT EXISTS health_record_access_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  national_id TEXT NOT NULL,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  scope TEXT NOT NULL DEFAULT 'summary' CHECK(scope IN ('summary', 'full')),
  created_by_role TEXT NOT NULL DEFAULT 'patient' CHECK(created_by_role IN ('patient', 'staff')),
  created_by_id INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  last_accessed_at TEXT,
  access_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_access_tokens_hash
  ON health_record_access_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_access_tokens_patient
  ON health_record_access_tokens(tenant_id, patient_id);

-- ── 5. Health Record Access Log (audit trail) ───────────────────
-- Every cross-tenant data access is logged here for compliance.

CREATE TABLE IF NOT EXISTS health_record_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  access_token_id INTEGER,
  national_id TEXT NOT NULL,
  source_tenant_id INTEGER NOT NULL,
  accessing_tenant_id INTEGER,
  accessing_user_id INTEGER,
  access_type TEXT NOT NULL CHECK(access_type IN ('qr_scan', 'nid_lookup', 'token_access', 'portal_view')),
  ip_address TEXT,
  user_agent TEXT,
  accessed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_access_log_nid
  ON health_record_access_log(national_id, accessed_at);

CREATE INDEX IF NOT EXISTS idx_access_log_source
  ON health_record_access_log(source_tenant_id, accessed_at);
