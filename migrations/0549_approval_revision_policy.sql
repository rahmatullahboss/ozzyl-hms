-- Revision-aware two-person approval decisions.
-- Existing requests and decisions remain revision 1. Returning a request for
-- correction may supersede revision-N decisions without deleting audit history.

ALTER TABLE approval_requests
  ADD COLUMN approval_revision INTEGER NOT NULL DEFAULT 1;

DROP INDEX IF EXISTS idx_approval_decisions_request;

ALTER TABLE approval_decisions
  RENAME TO approval_decisions_legacy_0542;

CREATE TABLE approval_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  approval_source TEXT NOT NULL DEFAULT 'approval_requests',
  approval_request_id INTEGER NOT NULL,
  approval_revision INTEGER NOT NULL DEFAULT 1
    CHECK (approval_revision > 0),
  approver_id INTEGER NOT NULL,
  approver_role TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'approve',
  notes TEXT,
  superseded_at TEXT,
  superseded_by_revision INTEGER,
  superseded_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (
    tenant_id,
    approval_source,
    approval_request_id,
    approval_revision,
    approver_id
  ),
  CHECK (
    (
      superseded_at IS NULL
      AND superseded_by_revision IS NULL
      AND superseded_reason IS NULL
    )
    OR (
      superseded_at IS NOT NULL
      AND superseded_by_revision IS NOT NULL
      AND superseded_by_revision > approval_revision
      AND length(trim(COALESCE(superseded_reason, ''))) > 0
    )
  )
);

INSERT INTO approval_decisions (
  id,
  tenant_id,
  approval_source,
  approval_request_id,
  approval_revision,
  approver_id,
  approver_role,
  decision,
  notes,
  created_at
)
SELECT
  id,
  tenant_id,
  approval_source,
  approval_request_id,
  1,
  approver_id,
  approver_role,
  decision,
  notes,
  created_at
FROM approval_decisions_legacy_0542;

DROP TABLE approval_decisions_legacy_0542;

CREATE INDEX IF NOT EXISTS idx_approval_decisions_request
  ON approval_decisions (
    tenant_id,
    approval_source,
    approval_request_id,
    approval_revision,
    created_at
  );

CREATE INDEX IF NOT EXISTS idx_approval_decisions_current
  ON approval_decisions (
    tenant_id,
    approval_source,
    approval_request_id,
    approval_revision,
    decision,
    superseded_at
  );

-- The application has supported correction events since the Approval Center
-- information-request flow was introduced, but the historical table CHECK was
-- never expanded beyond execution events. Rebuild it here so revision returns
-- are valid on real SQLite/D1 databases rather than only in mocked tests.
DROP INDEX IF EXISTS idx_approval_events_tenant_request;
DROP INDEX IF EXISTS idx_approval_events_tenant_created;

ALTER TABLE approval_events
  RENAME TO approval_events_legacy_0542;

CREATE TABLE approval_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  approval_request_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'created',
    'approved',
    'rejected',
    'request_info',
    'info_submitted',
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
  id,
  tenant_id,
  approval_request_id,
  action,
  actor_id,
  old_status,
  new_status,
  notes,
  metadata,
  created_at
)
SELECT
  id,
  tenant_id,
  approval_request_id,
  action,
  actor_id,
  old_status,
  new_status,
  notes,
  metadata,
  created_at
FROM approval_events_legacy_0542;

DROP TABLE approval_events_legacy_0542;

CREATE INDEX IF NOT EXISTS idx_approval_events_tenant_request
  ON approval_events(tenant_id, approval_request_id);

CREATE INDEX IF NOT EXISTS idx_approval_events_tenant_created
  ON approval_events(tenant_id, created_at);

DROP INDEX IF EXISTS idx_approval_requests_progress;
CREATE INDEX IF NOT EXISTS idx_approval_requests_progress
  ON approval_requests (
    tenant_id,
    status,
    approval_revision,
    approval_count,
    required_approvals
  );
