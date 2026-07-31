-- Add idempotent execution lock fields for executable approvals.
ALTER TABLE approval_requests ADD COLUMN execution_status TEXT DEFAULT 'not_required' CHECK(execution_status IN ('not_required', 'pending', 'processing', 'succeeded', 'failed'));
ALTER TABLE approval_requests ADD COLUMN execution_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE approval_requests ADD COLUMN execution_started_at TEXT;
ALTER TABLE approval_requests ADD COLUMN execution_completed_at TEXT;
ALTER TABLE approval_requests ADD COLUMN execution_error TEXT;
ALTER TABLE approval_requests ADD COLUMN locked_by INTEGER;
ALTER TABLE approval_requests ADD COLUMN locked_at TEXT;

UPDATE approval_requests
SET execution_status = CASE
  WHEN type IN ('bill_cancel', 'payment_void', 'refund') AND status = 'pending' THEN 'pending'
  WHEN type IN ('bill_cancel', 'payment_void', 'refund') AND status = 'approved' THEN 'succeeded'
  ELSE 'not_required'
END
WHERE execution_status IS NULL OR execution_status = 'not_required';

CREATE INDEX IF NOT EXISTS idx_approval_requests_execution_status
  ON approval_requests(tenant_id, execution_status, status);

PRAGMA foreign_keys=off;

CREATE TABLE IF NOT EXISTS approval_events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  approval_request_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'approved', 'rejected', 'bulk_approved', 'bulk_rejected', 'execution_started', 'execution_succeeded', 'execution_failed')),
  actor_id INTEGER,
  old_status TEXT,
  new_status TEXT,
  notes TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id)
);

INSERT OR IGNORE INTO approval_events_new (
  id, tenant_id, approval_request_id, action, actor_id, old_status, new_status, notes, metadata, created_at
)
SELECT id, tenant_id, approval_request_id, action, actor_id, old_status, new_status, notes, metadata, created_at
FROM approval_events;

DROP TABLE approval_events;
ALTER TABLE approval_events_new RENAME TO approval_events;

CREATE INDEX IF NOT EXISTS idx_approval_events_tenant_request
  ON approval_events(tenant_id, approval_request_id);

CREATE INDEX IF NOT EXISTS idx_approval_events_tenant_created
  ON approval_events(tenant_id, created_at);

PRAGMA foreign_keys=on;
