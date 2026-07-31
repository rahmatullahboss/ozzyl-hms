-- Structured approval event trail for enterprise approval center
CREATE TABLE IF NOT EXISTS approval_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  approval_request_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'approved', 'rejected', 'bulk_approved', 'bulk_rejected')),
  actor_id INTEGER,
  old_status TEXT,
  new_status TEXT,
  notes TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id)
);

CREATE INDEX IF NOT EXISTS idx_approval_events_tenant_request
  ON approval_events(tenant_id, approval_request_id);

CREATE INDEX IF NOT EXISTS idx_approval_events_tenant_created
  ON approval_events(tenant_id, created_at);
