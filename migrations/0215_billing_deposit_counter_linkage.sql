-- Link patient deposit ledger movements to the active billing counter session.
-- This is additive and safe for existing data; historical rows remain NULL.
ALTER TABLE billing_deposits ADD COLUMN counter_id INTEGER;
ALTER TABLE billing_deposits ADD COLUMN counter_session_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_billing_deposits_counter_session
  ON billing_deposits(tenant_id, counter_session_id, created_at);
