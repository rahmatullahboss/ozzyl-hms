-- Persistent Action Center exception cases and immutable lifecycle events.
-- Additive migration: source billing, cash, and inventory tables remain unchanged.

CREATE TABLE IF NOT EXISTS admin_exception_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  module TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('critical','warning','info')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  source_href TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','in_progress','snoozed','resolved','dismissed')),
  assigned_to INTEGER,
  first_detected_at TEXT NOT NULL,
  last_detected_at TEXT NOT NULL,
  acknowledged_by INTEGER,
  acknowledged_at TEXT,
  resolved_by INTEGER,
  resolved_at TEXT,
  resolution_code TEXT,
  resolution_note TEXT,
  dismissed_by INTEGER,
  dismissed_at TEXT,
  dismissal_reason TEXT,
  snoozed_until TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE(tenant_id, rule_key, fingerprint),
  UNIQUE(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS admin_exception_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  case_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_id INTEGER,
  old_status TEXT,
  new_status TEXT,
  note TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  FOREIGN KEY(tenant_id, case_id)
    REFERENCES admin_exception_cases(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_admin_exception_cases_status_severity_updated
  ON admin_exception_cases(tenant_id, status, severity, updated_at);

CREATE INDEX IF NOT EXISTS idx_admin_exception_cases_assignee_status
  ON admin_exception_cases(tenant_id, assigned_to, status);

CREATE INDEX IF NOT EXISTS idx_admin_exception_cases_rule_last_detected
  ON admin_exception_cases(tenant_id, rule_key, last_detected_at);

CREATE INDEX IF NOT EXISTS idx_admin_exception_events_case_created
  ON admin_exception_events(tenant_id, case_id, created_at);
