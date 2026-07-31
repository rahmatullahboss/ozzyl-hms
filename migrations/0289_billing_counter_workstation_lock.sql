-- 0289: Bind active billing counter sessions to one browser workstation.
-- The frontend sends X-HMS-Workstation-ID from localStorage. If the heartbeat
-- is stale, the same cashier can reclaim the session from another computer.

ALTER TABLE billing_counter_sessions ADD COLUMN workstation_id TEXT;
ALTER TABLE billing_counter_sessions ADD COLUMN heartbeat_at TEXT;

CREATE INDEX IF NOT EXISTS idx_billing_counter_sessions_workstation
  ON billing_counter_sessions(tenant_id, employee_id, workstation_id, status);
