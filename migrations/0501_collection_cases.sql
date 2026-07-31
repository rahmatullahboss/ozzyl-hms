-- =============================================================================
-- Unified Action Center: Canonical-ready collection workflow cases
--
-- Financial authority remains outside these tables. Legacy tenants read balances
-- from bills/payments; canonical tenants read canonical invoice projections.
-- This migration stores only collection workflow state and stable source links.
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS collection_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'invoice' CHECK(source_type = 'invoice'),
  canonical_invoice_public_id TEXT,
  legacy_bill_id INTEGER,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN (
    'new','contact_due','contacted','promised','disputed','escalated','write_off_requested','closed'
  )),
  assigned_to INTEGER,
  next_followup_at_utc TEXT,
  promise_date TEXT,
  promise_amount_minor INTEGER,
  currency_code TEXT,
  latest_note TEXT,
  last_contacted_at_utc TEXT,
  closed_at_utc TEXT,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(canonical_invoice_public_id IS NOT NULL OR legacy_bill_id IS NOT NULL),
  CHECK(canonical_invoice_public_id IS NULL OR length(trim(canonical_invoice_public_id)) > 0),
  CHECK(legacy_bill_id IS NULL OR legacy_bill_id > 0),
  CHECK(promise_amount_minor IS NULL OR promise_amount_minor > 0),
  CHECK(currency_code IS NULL OR (length(currency_code) = 3 AND currency_code = upper(currency_code))),
  CHECK(
    (promise_amount_minor IS NULL AND currency_code IS NULL)
    OR (promise_amount_minor IS NOT NULL AND currency_code IS NOT NULL)
  ),
  CHECK(promise_date IS NULL OR promise_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK(next_followup_at_utc IS NULL OR substr(next_followup_at_utc, -1) = 'Z'),
  CHECK(last_contacted_at_utc IS NULL OR substr(last_contacted_at_utc, -1) = 'Z'),
  CHECK(closed_at_utc IS NULL OR substr(closed_at_utc, -1) = 'Z'),
  CHECK(substr(created_at_utc, -1) = 'Z'),
  CHECK(substr(updated_at_utc, -1) = 'Z'),
  CHECK(
    (status = 'closed' AND closed_at_utc IS NOT NULL)
    OR (status <> 'closed' AND closed_at_utc IS NULL)
  ),
  UNIQUE(tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_collection_cases_canonical_invoice
  ON collection_cases(tenant_id, canonical_invoice_public_id)
  WHERE canonical_invoice_public_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_collection_cases_legacy_bill
  ON collection_cases(tenant_id, legacy_bill_id)
  WHERE legacy_bill_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_collection_cases_status_followup
  ON collection_cases(tenant_id, status, next_followup_at_utc, updated_at_utc);

CREATE INDEX IF NOT EXISTS idx_collection_cases_assignee_status
  ON collection_cases(tenant_id, assigned_to, status, updated_at_utc);

CREATE TABLE IF NOT EXISTS collection_case_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  case_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_id INTEGER,
  old_status TEXT,
  new_status TEXT,
  note TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(length(trim(event_type)) > 0),
  CHECK(old_status IS NULL OR old_status IN (
    'new','contact_due','contacted','promised','disputed','escalated','write_off_requested','closed'
  )),
  CHECK(new_status IS NULL OR new_status IN (
    'new','contact_due','contacted','promised','disputed','escalated','write_off_requested','closed'
  )),
  CHECK(substr(created_at_utc, -1) = 'Z'),
  FOREIGN KEY(tenant_id, case_id)
    REFERENCES collection_cases(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_collection_case_events_case_created
  ON collection_case_events(tenant_id, case_id, created_at_utc, id);
