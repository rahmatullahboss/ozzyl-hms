-- Controlled analyzer inbox supersession workflow.
-- Existing evidence is never rewritten. A reviewer creates one immutable direct
-- successor and a second reviewer must accept that successor.

CREATE UNIQUE INDEX IF NOT EXISTS ux_lis_analyzer_inbox_direct_successor
  ON lis_analyzer_inbox(tenant_id, supersedes_inbox_id)
  WHERE supersedes_inbox_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lis_inbox_supersession_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  source_inbox_id INTEGER NOT NULL REFERENCES lis_analyzer_inbox(id),
  source_state_version INTEGER NOT NULL CHECK (source_state_version >= 1),
  target_lab_order_item_id INTEGER NOT NULL REFERENCES lab_order_items(id),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  requester_role TEXT NOT NULL,
  reason TEXT NOT NULL,
  qc_override_reason TEXT,
  validation_override_reason TEXT,
  command_status TEXT NOT NULL DEFAULT 'claimed'
    CHECK (command_status IN ('claimed', 'completed')),
  superseding_inbox_id INTEGER REFERENCES lis_analyzer_inbox(id),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  UNIQUE (tenant_id, source_inbox_id)
);

CREATE INDEX IF NOT EXISTS idx_lis_inbox_supersession_commands_target
  ON lis_inbox_supersession_commands(tenant_id, target_lab_order_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lis_inbox_supersession_commands_requester
  ON lis_inbox_supersession_commands(tenant_id, requested_by, created_at DESC);
