-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0108: Consent Granularity — Purpose defaults, expiry tracking
-- Sprint 2: Fine-grained consent scoping, TPO rules, auto-cleanup
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Consent Purpose Defaults ─────────────────────────────────────────────
-- Hospitals configure default access rules per purpose (HIPAA TPO equivalent).
-- TREATMENT auto-grants view_summary when doctor has active visit.
-- RESEARCH requires explicit patient consent.

CREATE TABLE IF NOT EXISTS consent_purpose_defaults (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('TREATMENT', 'PAYMENT', 'OPERATIONS', 'RESEARCH', 'MARKETING')),
  default_scope TEXT NOT NULL CHECK(default_scope IN ('view_summary', 'view_full', 'none')) DEFAULT 'none',
  default_clinical_areas TEXT,  -- JSON array: ["labs","vitals",...] or NULL = all
  auto_grant INTEGER NOT NULL DEFAULT 0,
  requires_explicit_consent INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, purpose)
);

CREATE INDEX IF NOT EXISTS idx_consent_purpose_defaults_tenant
  ON consent_purpose_defaults(tenant_id);

-- ── 2. Add purpose + auto-grant tracking to consents ────────────────────────
-- purpose: why this consent exists (TREATMENT, PAYMENT, etc.)
-- auto_granted: 1 = system-generated (TPO), 0 = patient-granted

ALTER TABLE health_record_consents ADD COLUMN purpose TEXT DEFAULT 'TREATMENT';
ALTER TABLE health_record_consents ADD COLUMN auto_granted INTEGER DEFAULT 0;

-- ── 3. Expiry tracking ──────────────────────────────────────────────────────
-- expired_at: when the consent was auto-expired by cleanup
-- Separate from revoked_at (patient-initiated) vs expired_at (system-initiated)

ALTER TABLE health_record_consents ADD COLUMN expired_at TEXT;

-- ── 4. Index for efficient expiry cleanup ───────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_consents_expiry_cleanup
  ON health_record_consents(is_active, expires_at);

CREATE INDEX IF NOT EXISTS idx_consents_purpose
  ON health_record_consents(purpose, auto_granted);

-- ── 5. Widen health_record_access_log CHECK constraint ─────────────────────
-- The original CHECK (migration 0072) only allows: qr_scan, nid_lookup,
-- token_access, portal_view. We need: treatment_auto_grant, emergency_override,
-- consent_revoke for the new consent/TPO features.
-- SQLite doesn't support ALTER CHECK, so we recreate the table.

CREATE TABLE IF NOT EXISTS health_record_access_log_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  access_token_id INTEGER,
  national_id TEXT NOT NULL,
  source_tenant_id INTEGER NOT NULL,
  accessing_tenant_id INTEGER,
  accessing_user_id INTEGER,
  access_type TEXT NOT NULL CHECK(access_type IN (
    'qr_scan', 'nid_lookup', 'token_access', 'portal_view',
    'treatment_auto_grant', 'emergency_override', 'consent_revoke'
  )),
  ip_address TEXT,
  user_agent TEXT,
  accessed_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO health_record_access_log_v2
  SELECT * FROM health_record_access_log;

DROP TABLE health_record_access_log;

ALTER TABLE health_record_access_log_v2 RENAME TO health_record_access_log;

CREATE INDEX IF NOT EXISTS idx_access_log_nid
  ON health_record_access_log(national_id, accessed_at);

CREATE INDEX IF NOT EXISTS idx_access_log_source
  ON health_record_access_log(source_tenant_id, accessed_at);
