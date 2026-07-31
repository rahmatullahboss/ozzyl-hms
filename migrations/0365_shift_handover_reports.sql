-- Migration 0365: immutable reception shift handover report snapshots.
-- Finalized shift reports must remain stable even if later operational rows change.

CREATE TABLE IF NOT EXISTS shift_handover_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  session_id INTEGER NOT NULL REFERENCES billing_counter_sessions(id),
  report_no TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'finalized'
    CHECK(status IN ('finalized','accepted','void')),
  generated_by INTEGER NOT NULL REFERENCES users(id),
  generated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  finalized_by INTEGER REFERENCES users(id),
  finalized_at TEXT,
  accepted_by INTEGER REFERENCES users(id),
  accepted_at TEXT,
  voided_by INTEGER REFERENCES users(id),
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_handover_reports_session_final
  ON shift_handover_reports(tenant_id, session_id)
  WHERE status IN ('finalized','accepted');

CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_handover_reports_no
  ON shift_handover_reports(tenant_id, report_no);

CREATE INDEX IF NOT EXISTS idx_shift_handover_reports_tenant_status
  ON shift_handover_reports(tenant_id, status, generated_at);
