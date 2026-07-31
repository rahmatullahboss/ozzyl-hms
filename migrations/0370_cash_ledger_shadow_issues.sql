-- Migration: 0370_cash_ledger_shadow_issues.sql
-- Description: Adds non-blocking shadow-write issue log for canonical cash ledger migration monitoring.

CREATE TABLE IF NOT EXISTS cash_ledger_shadow_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  idempotency_key TEXT,
  issue_message TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX IF NOT EXISTS idx_cash_ledger_shadow_issues_tenant_created
  ON cash_ledger_shadow_issues(tenant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_cash_ledger_shadow_issues_source
  ON cash_ledger_shadow_issues(tenant_id, source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_cash_ledger_shadow_issues_event
  ON cash_ledger_shadow_issues(tenant_id, event_type, created_at);
