-- Two-person approval policy with optional supporting evidence.
-- Additive only: existing approved rows remain readable as fully approved,
-- but no synthetic approver identities are invented.

ALTER TABLE approval_requests ADD COLUMN required_approvals INTEGER NOT NULL DEFAULT 2;
ALTER TABLE approval_requests ADD COLUMN approval_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE approval_requests ADD COLUMN first_approved_at TEXT;
ALTER TABLE approval_requests ADD COLUMN fully_approved_at TEXT;

CREATE TABLE IF NOT EXISTS approval_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  approval_source TEXT NOT NULL DEFAULT 'approval_requests',
  approval_request_id INTEGER NOT NULL,
  approver_id INTEGER NOT NULL,
  approver_role TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'approve',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, approval_source, approval_request_id, approver_id)
);

CREATE INDEX IF NOT EXISTS idx_approval_decisions_request
  ON approval_decisions (tenant_id, approval_source, approval_request_id, created_at);

CREATE INDEX IF NOT EXISTS idx_approval_requests_progress
  ON approval_requests (tenant_id, status, approval_count, required_approvals);

UPDATE approval_requests
SET required_approvals = 2,
    approval_count = 2,
    first_approved_at = COALESCE(first_approved_at, reviewed_at, created_at),
    fully_approved_at = COALESCE(fully_approved_at, reviewed_at, created_at)
WHERE status = 'approved' AND approval_count = 0;
