-- Durable operational cash reservations for approval-based bill refunds.
CREATE TABLE IF NOT EXISTS billing_refund_cash_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  approval_request_id INTEGER NOT NULL,
  bill_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method = 'cash'),
  employee_id INTEGER NOT NULL,
  counter_id INTEGER NOT NULL,
  counter_session_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'consumed', 'released')),
  idempotency_key TEXT NOT NULL,
  credit_note_id INTEGER,
  held_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  consumed_at TEXT,
  released_at TEXT,
  resolved_by INTEGER,
  resolution_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, approval_request_id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_refund_holds_tenant_status
  ON billing_refund_cash_holds(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_refund_holds_counter_session
  ON billing_refund_cash_holds(tenant_id, counter_session_id, status);
CREATE INDEX IF NOT EXISTS idx_refund_holds_bill_status
  ON billing_refund_cash_holds(tenant_id, bill_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_hold_bill_held
  ON billing_refund_cash_holds(tenant_id, bill_id)
  WHERE status = 'held';

-- Enforce the reservation at the write boundary, not only in route pre-checks.
-- This closes the race where two workstations both read the same available cash
-- before either hold is inserted.
CREATE TRIGGER IF NOT EXISTS trg_refund_hold_validate_before_insert
BEFORE INSERT ON billing_refund_cash_holds
WHEN NEW.status = 'held'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM billing_counter_sessions s
      WHERE s.tenant_id = NEW.tenant_id
        AND s.id = NEW.counter_session_id
        AND s.employee_id = NEW.employee_id
        AND s.counter_id = NEW.counter_id
        AND s.status = 'active'
    )
    THEN RAISE(ABORT, 'refund hold requires active originating counter session')
  END;

  SELECT CASE
    WHEN NEW.amount > COALESCE((
      SELECT
        COALESCE(s.opening_cash, 0)
        + COALESCE((
          SELECT SUM(CASE
            WHEN ect.payment_method = 'cash'
             AND ect.transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived')
            THEN ect.amount
            WHEN ect.payment_method = 'cash'
             AND ect.transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven')
            THEN -ect.amount
            ELSE 0
          END)
          FROM emp_cash_transactions ect
          WHERE ect.tenant_id = s.tenant_id
            AND ect.counter_session_id = s.id
        ), 0)
        + COALESCE((
          SELECT SUM(CASE
            WHEN cdm.movement_type = 'cash_in' THEN cdm.amount
            WHEN cdm.movement_type IN ('cash_out', 'cash_drop') THEN -cdm.amount
            ELSE 0
          END)
          FROM cash_drawer_movements cdm
          WHERE cdm.tenant_id = s.tenant_id
            AND cdm.counter_session_id = s.id
        ), 0)
        - COALESCE((
          SELECT SUM(existing.amount)
          FROM billing_refund_cash_holds existing
          WHERE existing.tenant_id = s.tenant_id
            AND existing.counter_session_id = s.id
            AND existing.status = 'held'
        ), 0)
      FROM billing_counter_sessions s
      WHERE s.tenant_id = NEW.tenant_id
        AND s.id = NEW.counter_session_id
        AND s.employee_id = NEW.employee_id
        AND s.counter_id = NEW.counter_id
        AND s.status = 'active'
    ), 0)
    THEN RAISE(ABORT, 'insufficient counter cash for refund hold')
  END;
END;
