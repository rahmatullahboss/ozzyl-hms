-- =============================================================================
-- HMS Canonical Service Catalog and Effective Pricing (D1 / SQLite)
-- Additive-only catalog authority. Legacy billing, lab, radiology, consultation,
-- bed, procedure, and product sources remain unchanged until explicit cutover.
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_service_catalog_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  service_public_id TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  canonical_code TEXT,
  display_name TEXT NOT NULL,
  unit_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (item_kind IN ('laboratory','radiology','consultation','bed','procedure','product','other')),
  CHECK (status IN ('active','inactive','retired')),
  CHECK (length(trim(display_name)) > 0),
  CHECK (length(trim(unit_code)) > 0),
  CHECK (length(source_evidence_sha256) = 64),
  UNIQUE (tenant_id, service_public_id),
  UNIQUE (tenant_id, canonical_code)
);

CREATE INDEX IF NOT EXISTS idx_canonical_service_catalog_kind_status
  ON canonical_service_catalog_items(tenant_id, item_kind, status, display_name);
CREATE INDEX IF NOT EXISTS idx_canonical_service_catalog_name
  ON canonical_service_catalog_items(tenant_id, display_name, service_public_id);

CREATE TABLE IF NOT EXISTS canonical_service_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  price_public_id TEXT NOT NULL,
  service_public_id TEXT NOT NULL,
  price_context_type TEXT NOT NULL,
  price_context_key TEXT NOT NULL DEFAULT '',
  amount_minor INTEGER NOT NULL,
  currency_code TEXT NOT NULL,
  valid_from_utc TEXT NOT NULL,
  valid_to_utc TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (price_context_type IN ('base','price_category','appointment_type','bed_rate','sale')),
  CHECK (amount_minor >= 0),
  CHECK (length(currency_code) = 3 AND currency_code = upper(currency_code)),
  CHECK (substr(valid_from_utc, -1) = 'Z'),
  CHECK (valid_to_utc IS NULL OR substr(valid_to_utc, -1) = 'Z'),
  CHECK (valid_to_utc IS NULL OR valid_to_utc > valid_from_utc),
  CHECK (status IN ('active','inactive','retired')),
  CHECK (length(source_evidence_sha256) = 64),
  FOREIGN KEY (tenant_id, service_public_id)
    REFERENCES canonical_service_catalog_items(tenant_id, service_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, price_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_service_prices_effective
  ON canonical_service_prices(
    tenant_id, service_public_id, price_context_type, price_context_key,
    status, valid_from_utc, valid_to_utc
  );
CREATE INDEX IF NOT EXISTS idx_canonical_service_prices_currency
  ON canonical_service_prices(tenant_id, currency_code, status, valid_from_utc);
