-- =============================================================================
-- HMS Canonical Practitioner Identity (D1 / SQLite)
-- Additive-only practitioner, identity-link, identifier, specialty, and
-- department structures. Legacy doctors/referrers remain unchanged.
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_practitioners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  practitioner_public_id TEXT NOT NULL,
  practitioner_kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (practitioner_kind IN ('internal', 'external')),
  CHECK (status IN ('active', 'inactive', 'unknown')),
  UNIQUE (tenant_id, practitioner_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_practitioners_kind_status
  ON canonical_practitioners(tenant_id, practitioner_kind, status, practitioner_public_id);

CREATE TABLE IF NOT EXISTS canonical_practitioner_user_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  practitioner_public_id TEXT NOT NULL,
  legacy_user_id INTEGER NOT NULL,
  link_status TEXT NOT NULL DEFAULT 'active',
  evidence_type TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (link_status IN ('active', 'rejected', 'retired')),
  CHECK (evidence_type IN ('legacy_doctor_user_id', 'approved_manual')),
  FOREIGN KEY (tenant_id, practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, practitioner_public_id),
  UNIQUE (tenant_id, legacy_user_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_practitioner_user_links_status
  ON canonical_practitioner_user_links(tenant_id, link_status, legacy_user_id);

CREATE TABLE IF NOT EXISTS canonical_practitioner_employee_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  practitioner_public_id TEXT NOT NULL,
  legacy_staff_id INTEGER NOT NULL,
  link_status TEXT NOT NULL DEFAULT 'active',
  evidence_type TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (link_status IN ('active', 'rejected', 'retired')),
  CHECK (evidence_type IN ('shared_explicit_user_id', 'approved_manual')),
  FOREIGN KEY (tenant_id, practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, practitioner_public_id),
  UNIQUE (tenant_id, legacy_staff_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_practitioner_employee_links_status
  ON canonical_practitioner_employee_links(tenant_id, link_status, legacy_staff_id);

CREATE TABLE IF NOT EXISTS canonical_practitioner_identifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  practitioner_public_id TEXT NOT NULL,
  identifier_system TEXT NOT NULL,
  issuer_key TEXT NOT NULL DEFAULT '',
  normalized_value TEXT NOT NULL,
  display_value TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (identifier_system IN ('bmdc', 'employee_code', 'other')),
  CHECK (verification_status IN ('unverified', 'verified', 'rejected', 'retired')),
  FOREIGN KEY (tenant_id, practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, identifier_system, issuer_key, normalized_value),
  UNIQUE (tenant_id, practitioner_public_id, identifier_system, issuer_key, normalized_value)
);

CREATE INDEX IF NOT EXISTS idx_canonical_practitioner_identifiers_practitioner
  ON canonical_practitioner_identifiers(tenant_id, practitioner_public_id, verification_status);

CREATE TABLE IF NOT EXISTS canonical_practitioner_specialties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  practitioner_public_id TEXT NOT NULL,
  normalized_key TEXT NOT NULL,
  display_text TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 1,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (is_primary IN (0, 1)),
  FOREIGN KEY (tenant_id, practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, practitioner_public_id, normalized_key)
);

CREATE INDEX IF NOT EXISTS idx_canonical_practitioner_specialties_lookup
  ON canonical_practitioner_specialties(tenant_id, normalized_key, is_primary);

CREATE TABLE IF NOT EXISTS canonical_practitioner_departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  practitioner_public_id TEXT NOT NULL,
  normalized_key TEXT NOT NULL,
  display_text TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 1,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (is_primary IN (0, 1)),
  FOREIGN KEY (tenant_id, practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, practitioner_public_id, normalized_key)
);

CREATE INDEX IF NOT EXISTS idx_canonical_practitioner_departments_lookup
  ON canonical_practitioner_departments(tenant_id, normalized_key, is_primary);
