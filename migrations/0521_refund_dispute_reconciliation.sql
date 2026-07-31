PRAGMA foreign_keys=OFF;
PRAGMA defer_foreign_keys=ON;

DROP TRIGGER IF EXISTS trg_refund_hold_validate_before_insert;
DROP INDEX IF EXISTS idx_refund_holds_tenant_status;
DROP INDEX IF EXISTS idx_refund_holds_counter_session;
DROP INDEX IF EXISTS idx_refund_holds_bill_status;
DROP INDEX IF EXISTS idx_refund_holds_custody_release;
DROP INDEX IF EXISTS uq_refund_hold_bill_held;

ALTER TABLE billing_refund_cash_holds RENAME TO billing_refund_cash_holds_legacy_0521;

CREATE TABLE billing_refund_cash_holds (
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
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'consumed', 'released', 'disputed', 'settled')),
  idempotency_key TEXT NOT NULL,
  credit_note_id INTEGER,
  held_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  consumed_at TEXT,
  released_at TEXT,
  custody_user_id INTEGER,
  release_status TEXT NOT NULL DEFAULT 'not_applicable'
    CHECK (release_status IN ('not_applicable', 'pending', 'credited')),
  release_counter_session_id INTEGER,
  release_cash_movement_id INTEGER,
  release_credited_at TEXT,
  resolved_by INTEGER,
  resolution_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, approval_request_id),
  UNIQUE (tenant_id, idempotency_key)
);

INSERT INTO billing_refund_cash_holds (
  id, tenant_id, approval_request_id, bill_id, patient_id, amount,
  payment_method, employee_id, counter_id, counter_session_id, status,
  idempotency_key, credit_note_id, held_at, consumed_at, released_at,
  custody_user_id, release_status, release_counter_session_id,
  release_cash_movement_id, release_credited_at, resolved_by,
  resolution_reason, created_at, updated_at
)
SELECT
  id, tenant_id, approval_request_id, bill_id, patient_id, amount,
  payment_method, employee_id, counter_id, counter_session_id, status,
  idempotency_key, credit_note_id, held_at, consumed_at, released_at,
  custody_user_id, release_status, release_counter_session_id,
  release_cash_movement_id, release_credited_at, resolved_by,
  resolution_reason, created_at, updated_at
FROM billing_refund_cash_holds_legacy_0521;

DROP TABLE billing_refund_cash_holds_legacy_0521;

CREATE INDEX IF NOT EXISTS idx_refund_holds_tenant_status
  ON billing_refund_cash_holds(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_refund_holds_counter_session
  ON billing_refund_cash_holds(tenant_id, counter_session_id, status);
CREATE INDEX IF NOT EXISTS idx_refund_holds_bill_status
  ON billing_refund_cash_holds(tenant_id, bill_id, status);
CREATE INDEX IF NOT EXISTS idx_refund_holds_custody_release
  ON billing_refund_cash_holds(tenant_id, custody_user_id, status, release_status, released_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_hold_bill_held
  ON billing_refund_cash_holds(tenant_id, bill_id)
  WHERE status = 'held';

CREATE TABLE billing_refund_cash_disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  refund_cash_hold_id INTEGER NOT NULL,
  approval_request_id INTEGER NOT NULL,
  bill_id INTEGER NOT NULL,
  requester_user_id INTEGER NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','recovery_pending','recovered','writeoff_pending','written_off')),
  rejection_reason TEXT NOT NULL,
  rejected_by INTEGER NOT NULL,
  rejected_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  custody_user_id INTEGER,
  counter_id INTEGER NOT NULL,
  counter_session_id INTEGER NOT NULL,
  dispute_cash_movement_id INTEGER,
  settlement_method TEXT CHECK (settlement_method IS NULL OR settlement_method IN ('cash_recovery','authorized_writeoff')),
  settlement_reference_type TEXT,
  settlement_reference_id INTEGER,
  settlement_idempotency_key TEXT,
  settled_by INTEGER,
  settled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, refund_cash_hold_id),
  UNIQUE (tenant_id, settlement_idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_refund_disputes_tenant_status
  ON billing_refund_cash_disputes(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_refund_disputes_requester_status
  ON billing_refund_cash_disputes(tenant_id, requester_user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_refund_disputes_approval
  ON billing_refund_cash_disputes(tenant_id, approval_request_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_dispute_cash_out
  ON cash_drawer_movements(tenant_id, reference_type, reference_id, movement_type)
  WHERE reference_type = 'refund_cash_dispute'
    AND movement_type = 'cash_out';

CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_dispute_cash_recovery
  ON cash_drawer_movements(tenant_id, reference_type, reference_id, movement_type)
  WHERE reference_type = 'refund_cash_dispute'
    AND movement_type = 'cash_in';

PRAGMA defer_foreign_keys=OFF;
PRAGMA foreign_keys=ON;
