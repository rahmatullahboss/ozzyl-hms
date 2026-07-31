ALTER TABLE billing_handovers ADD COLUMN counter_session_id INTEGER REFERENCES billing_counter_sessions(id);

CREATE INDEX IF NOT EXISTS idx_billing_handovers_counter_session
  ON billing_handovers(tenant_id, counter_session_id);
