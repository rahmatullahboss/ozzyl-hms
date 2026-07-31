-- Migration: 0349_portal_consent_hardening.sql
-- fix/portal-consent: P0-10, P0-29, P0-30, P0-31, P0-32, P0-33
--
-- 1. Patient merge confirmation tokens + idempotency + audit (P0-10)
-- 2. Global patient auth verification status (P0-29)
-- 3. Hospital links: pending state, default-deny consents, verify endpoint
--    audit, explicit-link cross-tenant consent (P0-30, P0-31)
-- 4. Cross-tenant bridge: verified-link table (P0-30, P0-32)
-- 5. Portal consent audit (P0-30, P0-32)

-- ─── 1. Patient Merge: confirmation tokens + idempotency + audit (P0-10) ────

CREATE TABLE IF NOT EXISTS patient_merge_confirmation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  confirmation_token_hash TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  primary_patient_id INTEGER NOT NULL,
  secondary_patient_id INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'applied', 'expired', 'revoked')),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  applied_at TEXT,
  applied_merge_log_id INTEGER,
  UNIQUE(tenant_id, request_hash)
);

CREATE INDEX IF NOT EXISTS idx_merge_confirm_tenant
  ON patient_merge_confirmation(tenant_id, status);

CREATE TABLE IF NOT EXISTS patient_merge_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  merge_log_id INTEGER,
  action TEXT NOT NULL CHECK(action IN (
    'preview', 'confirm', 'apply', 'apply_failed', 'unmerge', 'unmerge_failed',
    'rollback', 'idempotent_replay'
  )),
  primary_patient_id INTEGER,
  secondary_patient_id INTEGER,
  confirmation_token_hash TEXT,
  payload_json TEXT,
  result_json TEXT,
  actor_user_id INTEGER,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_merge_audit_tenant_log
  ON patient_merge_audit(tenant_id, merge_log_id);
CREATE INDEX IF NOT EXISTS idx_merge_audit_actor
  ON patient_merge_audit(tenant_id, actor_user_id, created_at);

ALTER TABLE patient_merge_log ADD COLUMN confirmation_token_hash TEXT;
ALTER TABLE patient_merge_log ADD COLUMN request_hash TEXT;
ALTER TABLE patient_merge_log ADD COLUMN rows_moved_json TEXT;
ALTER TABLE patient_merge_log ADD COLUMN applied_by INTEGER;
ALTER TABLE patient_merge_log ADD COLUMN applied_at TEXT;

-- ─── 2. Global patient auth: pending_verification + proof basis (P0-29) ──────

ALTER TABLE global_patient_identity
  ADD COLUMN identity_status TEXT NOT NULL DEFAULT 'verified'
    CHECK(identity_status IN ('pending_verification', 'verified', 'suspended'));
ALTER TABLE global_patient_identity
  ADD COLUMN identity_proof_basis TEXT;
ALTER TABLE global_patient_identity
  ADD COLUMN identity_verified_at TEXT;
ALTER TABLE global_patient_identity
  ADD COLUMN identity_verified_method TEXT;
ALTER TABLE global_patient_identity
  ADD COLUMN identity_verified_by INTEGER;

ALTER TABLE global_patient_auth
  ADD COLUMN auth_status TEXT NOT NULL DEFAULT 'verified'
    CHECK(auth_status IN ('pending_verification', 'verified', 'suspended'));
ALTER TABLE global_patient_auth
  ADD COLUMN auth_proof_basis TEXT;
ALTER TABLE global_patient_auth
  ADD COLUMN auth_verified_at TEXT;
ALTER TABLE global_patient_auth
  ADD COLUMN auth_verified_method TEXT;
ALTER TABLE global_patient_auth
  ADD COLUMN phone_verified INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS patient_register_request (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_hash TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  national_id TEXT,
  payload_json TEXT NOT NULL,
  response_json TEXT,
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(request_hash)
);

CREATE INDEX IF NOT EXISTS idx_register_request_email
  ON patient_register_request(email);
CREATE INDEX IF NOT EXISTS idx_register_request_phone
  ON patient_register_request(phone);

-- ─── 3. Hospital links: pending-by-default, denied-by-default, verify (P0-31) ─

CREATE TABLE IF NOT EXISTS hospital_link_verification (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL REFERENCES hospital_links(id),
  action TEXT NOT NULL CHECK(action IN (
    'verify_requested', 'verify_approved', 'verify_rejected', 'verify_revoked',
    'consent_granted', 'consent_revoked'
  )),
  proof_basis TEXT NOT NULL,
  proof_payload TEXT,
  actor_user_id INTEGER,
  tenant_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hlv_link
  ON hospital_link_verification(link_id, created_at);
CREATE INDEX IF NOT EXISTS idx_hlv_tenant
  ON hospital_link_verification(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS hospital_link_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER,
  tenant_id TEXT,
  action TEXT NOT NULL CHECK(action IN (
    'link_list', 'link_request', 'link_verify_approve', 'link_verify_reject',
    'link_revoke', 'consent_update', 'lookup_data', 'lookup_no_match',
    'lookup_unverified'
  )),
  outcome TEXT NOT NULL CHECK(outcome IN ('success', 'denied', 'pending', 'not_found', 'error')),
  details_json TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hla_patient
  ON hospital_link_audit(patient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_hla_tenant
  ON hospital_link_audit(tenant_id, created_at);

-- ─── 4. Explicit verified patient-hospital link table (P0-30, P0-32) ─────────

CREATE TABLE IF NOT EXISTS patient_hospital_link_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  global_user_id INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  national_id TEXT,
  verification_method TEXT NOT NULL,
  verification_proof TEXT,
  verified_by_user_id INTEGER,
  verified_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  revoked_by_user_id INTEGER,
  revoke_reason TEXT,
  UNIQUE(global_user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_phlv_user
  ON patient_hospital_link_verifications(global_user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_phlv_tenant
  ON patient_hospital_link_verifications(tenant_id, revoked_at);

CREATE TABLE IF NOT EXISTS patient_bridge_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  global_user_id INTEGER,
  tenant_id TEXT,
  resolution_path TEXT NOT NULL CHECK(resolution_path IN (
    'verified_link', 'uhid_fallback_blocked', 'email_fallback_blocked',
    'phone_fallback_blocked', 'no_match', 'rate_limited'
  )),
  requested_patient_id INTEGER,
  resolved_patient_id INTEGER,
  request_token_hash TEXT,
  details_json TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pba_user
  ON patient_bridge_audit(global_user_id, created_at);

-- ─── 5. Self-registration block (in addition to KV counters, P0-29) ─────────

CREATE TABLE IF NOT EXISTS patient_auth_block (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  global_user_id INTEGER,
  identifier TEXT NOT NULL,
  identifier_type TEXT NOT NULL CHECK(identifier_type IN ('email', 'phone', 'national_id')),
  reason TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pab_identifier
  ON patient_auth_block(identifier, identifier_type, expires_at);
