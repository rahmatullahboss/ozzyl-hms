ALTER TABLE billing_settlements ADD COLUMN counter_id INTEGER;
ALTER TABLE billing_settlements ADD COLUMN counter_session_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_settlements_counter_session
  ON billing_settlements(tenant_id, counter_session_id, created_at);

ALTER TABLE billing_credit_notes ADD COLUMN counter_id INTEGER;
ALTER TABLE billing_credit_notes ADD COLUMN counter_session_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_credit_notes_counter_session
  ON billing_credit_notes(tenant_id, counter_session_id, created_at);
