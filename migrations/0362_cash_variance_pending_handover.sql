-- Migration 0362: store pending high-variance counter close handover intent.
-- Additive only; existing approval rows remain valid.

ALTER TABLE cash_variance_approvals ADD COLUMN handover_to INTEGER;
ALTER TABLE cash_variance_approvals ADD COLUMN handover_amount REAL DEFAULT 0;
ALTER TABLE cash_variance_approvals ADD COLUMN handover_due_amount REAL DEFAULT 0;
ALTER TABLE cash_variance_approvals ADD COLUMN handover_total REAL DEFAULT 0;
ALTER TABLE cash_variance_approvals ADD COLUMN handover_status TEXT
  CHECK(handover_status IN ('pending','partial') OR handover_status IS NULL);

-- Cash-custody safety guards. These prevent duplicate final custody rows if a
-- supervisor approval request is retried or races with another approval.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_variance_pending_once
  ON cash_variance_approvals(tenant_id, counter_session_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_handovers_counter_close_once
  ON billing_handovers(tenant_id, counter_session_id, handover_type)
  WHERE handover_type = 'counter';

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_drawer_handover_once
  ON cash_drawer_movements(tenant_id, counter_session_id, movement_type)
  WHERE movement_type = 'handover';