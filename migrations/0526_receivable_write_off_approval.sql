-- Expand approval_requests.type with the controlled receivable write-off workflow.
-- This rebuild preserves the current execution-lock and two-person approval
-- columns. SQLite/D1 cannot alter an existing CHECK constraint in place.
--
-- D1 executes a migration inside an active transaction. PRAGMA foreign_keys=off
-- is therefore ineffective for the approval_events -> approval_requests FK.
-- Preserve the child rows in an FK-free backup, remove the child table, rebuild
-- the parent, and recreate the child table before the transaction commits.

CREATE TABLE approval_events_write_off_backup (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  approval_request_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor_id INTEGER,
  old_status TEXT,
  new_status TEXT,
  notes TEXT,
  metadata TEXT,
  created_at TEXT
);

INSERT INTO approval_events_write_off_backup (
  id, tenant_id, approval_request_id, action, actor_id,
  old_status, new_status, notes, metadata, created_at
)
SELECT
  id, tenant_id, approval_request_id, action, actor_id,
  old_status, new_status, notes, metadata, created_at
FROM approval_events;

DROP TABLE approval_events;

CREATE TABLE approval_requests_write_off_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN (
    'bill_edit',
    'bill_cancel',
    'discount',
    'refund',
    'payment_void',
    'cash_handover',
    'expense',
    'stock_adjustment',
    'doctor_payout',
    'manual_adjustment',
    'credit_note',
    'receivable_write_off'
  )),
  entity_id INTEGER NOT NULL,
  entity_no TEXT,
  requested_by INTEGER NOT NULL,
  request_data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  reviewed_by INTEGER,
  reviewed_at TEXT,
  review_notes TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  execution_status TEXT DEFAULT 'not_required' CHECK(execution_status IN ('not_required', 'pending', 'processing', 'succeeded', 'failed')),
  execution_attempts INTEGER NOT NULL DEFAULT 0,
  execution_started_at TEXT,
  execution_completed_at TEXT,
  execution_error TEXT,
  locked_by INTEGER,
  locked_at TEXT,
  required_approvals INTEGER NOT NULL DEFAULT 2,
  approval_count INTEGER NOT NULL DEFAULT 0,
  first_approved_at TEXT,
  fully_approved_at TEXT
);

INSERT INTO approval_requests_write_off_new (
  id,
  tenant_id,
  type,
  entity_id,
  entity_no,
  requested_by,
  request_data,
  status,
  reviewed_by,
  reviewed_at,
  review_notes,
  created_at,
  execution_status,
  execution_attempts,
  execution_started_at,
  execution_completed_at,
  execution_error,
  locked_by,
  locked_at,
  required_approvals,
  approval_count,
  first_approved_at,
  fully_approved_at
)
SELECT
  id,
  tenant_id,
  type,
  entity_id,
  entity_no,
  requested_by,
  request_data,
  status,
  reviewed_by,
  reviewed_at,
  review_notes,
  created_at,
  execution_status,
  execution_attempts,
  execution_started_at,
  execution_completed_at,
  execution_error,
  locked_by,
  locked_at,
  required_approvals,
  approval_count,
  first_approved_at,
  fully_approved_at
FROM approval_requests;

DROP TABLE approval_requests;
ALTER TABLE approval_requests_write_off_new RENAME TO approval_requests;

CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant
  ON approval_requests(tenant_id);

CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant_type_status
  ON approval_requests(tenant_id, type, status);

CREATE INDEX IF NOT EXISTS idx_approval_requests_entity
  ON approval_requests(tenant_id, type, entity_id);

CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant_status_created
  ON approval_requests(tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant_status_type_created
  ON approval_requests(tenant_id, status, type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_approval_requests_execution_status
  ON approval_requests(tenant_id, execution_status, status);

CREATE INDEX IF NOT EXISTS idx_approval_requests_progress
  ON approval_requests(tenant_id, status, approval_count, required_approvals);

CREATE TABLE approval_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  approval_request_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'created',
    'approved',
    'rejected',
    'bulk_approved',
    'bulk_rejected',
    'execution_started',
    'execution_succeeded',
    'execution_failed'
  )),
  actor_id INTEGER,
  old_status TEXT,
  new_status TEXT,
  notes TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id)
);

INSERT INTO approval_events (
  id, tenant_id, approval_request_id, action, actor_id,
  old_status, new_status, notes, metadata, created_at
)
SELECT
  id, tenant_id, approval_request_id, action, actor_id,
  old_status, new_status, notes, metadata, created_at
FROM approval_events_write_off_backup;

DROP TABLE approval_events_write_off_backup;

CREATE INDEX IF NOT EXISTS idx_approval_events_tenant_request
  ON approval_events(tenant_id, approval_request_id);

CREATE INDEX IF NOT EXISTS idx_approval_events_tenant_created
  ON approval_events(tenant_id, created_at);
