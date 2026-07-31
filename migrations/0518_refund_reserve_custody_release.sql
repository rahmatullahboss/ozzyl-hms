-- Preserve refund reserve custody across counter close and release it safely on rejection.
-- Close-time snapshots keep the original reconciliation immutable and explain why
-- handed-over cash can be lower than gross expected drawer cash.
ALTER TABLE billing_counter_sessions ADD COLUMN refund_reserve_at_close REAL;
ALTER TABLE billing_counter_sessions ADD COLUMN available_cash_at_close REAL;
ALTER TABLE billing_counter_sessions ADD COLUMN total_physical_cash_at_close REAL;

ALTER TABLE billing_refund_cash_holds ADD COLUMN custody_user_id INTEGER;
ALTER TABLE billing_refund_cash_holds
  ADD COLUMN release_status TEXT NOT NULL DEFAULT 'not_applicable'
  CHECK (release_status IN ('not_applicable', 'pending', 'credited'));
ALTER TABLE billing_refund_cash_holds ADD COLUMN release_counter_session_id INTEGER;
ALTER TABLE billing_refund_cash_holds ADD COLUMN release_cash_movement_id INTEGER;
ALTER TABLE billing_refund_cash_holds ADD COLUMN release_credited_at TEXT;

CREATE INDEX IF NOT EXISTS idx_refund_holds_custody_release
  ON billing_refund_cash_holds(tenant_id, custody_user_id, status, release_status, released_at);

-- A released reserve may be credited into a drawer only once, even after retries.
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_reserve_release_cash_in
  ON cash_drawer_movements(tenant_id, reference_type, reference_id, movement_type)
  WHERE reference_type = 'refund_reserve_release'
    AND movement_type = 'cash_in';
