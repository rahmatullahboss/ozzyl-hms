CREATE TABLE IF NOT EXISTS billing_refund_commission_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  approval_request_id INTEGER NOT NULL,
  refund_cash_hold_id INTEGER NOT NULL,
  bill_id INTEGER NOT NULL,
  accrual_id INTEGER NOT NULL,
  invoice_item_id INTEGER,
  allocated_refund_amount REAL NOT NULL CHECK (allocated_refund_amount >= 0),
  commission_base_reduction REAL NOT NULL CHECK (commission_base_reduction >= 0),
  reserved_commission_amount REAL NOT NULL CHECK (reserved_commission_amount >= 0),
  original_commission_base_amount REAL NOT NULL,
  original_earned_commission_amount REAL NOT NULL,
  original_doctor_waiver_amount REAL NOT NULL,
  original_payable_commission_amount REAL NOT NULL,
  original_balance_amount REAL NOT NULL,
  reserved_commission_base_amount REAL NOT NULL,
  reserved_earned_commission_amount REAL NOT NULL,
  reserved_doctor_waiver_amount REAL NOT NULL,
  reserved_payable_commission_amount REAL NOT NULL,
  reserved_balance_amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'consumed', 'disputed', 'released', 'written_off')),
  created_by INTEGER,
  resolved_by INTEGER,
  resolution_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  resolved_at TEXT,
  UNIQUE (tenant_id, approval_request_id, accrual_id)
);

CREATE INDEX IF NOT EXISTS idx_refund_commission_reservations_status
  ON billing_refund_commission_reservations(tenant_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_refund_commission_reservations_hold
  ON billing_refund_commission_reservations(tenant_id, refund_cash_hold_id, status);

CREATE INDEX IF NOT EXISTS idx_refund_commission_reservations_bill
  ON billing_refund_commission_reservations(tenant_id, bill_id, status);
