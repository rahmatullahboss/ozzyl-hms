-- Migration: 0363_reception_cash_operations.sql
-- Description: Adds reception Cash Operations schema for doctor payout snapshots,
-- expense execution state, transfer acceptance metadata, settings, and drawer guards.

PRAGMA foreign_keys = ON;

-- Doctor payout settlement receipt/snapshot metadata.
ALTER TABLE doctor_commission_settlements ADD COLUMN settlement_no TEXT;
ALTER TABLE doctor_commission_settlements ADD COLUMN gross_commission_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_settlements ADD COLUMN advance_deduction REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_settlements ADD COLUMN other_adjustment REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_settlements ADD COLUMN rounding_adjustment REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_settlements ADD COLUMN net_paid_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_settlements ADD COLUMN receiver_type TEXT NOT NULL DEFAULT 'doctor' CHECK (receiver_type IN ('doctor', 'assistant', 'representative'));
ALTER TABLE doctor_commission_settlements ADD COLUMN receiver_name TEXT;
ALTER TABLE doctor_commission_settlements ADD COLUMN receiver_reference TEXT;
ALTER TABLE doctor_commission_settlements ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'bank', 'mobile_banking'));
ALTER TABLE doctor_commission_settlements ADD COLUMN counter_session_id INTEGER REFERENCES billing_counter_sessions(id);
ALTER TABLE doctor_commission_settlements ADD COLUMN counter_id INTEGER REFERENCES billing_counters(id);
ALTER TABLE doctor_commission_settlements ADD COLUMN cash_movement_id INTEGER REFERENCES cash_drawer_movements(id);
ALTER TABLE doctor_commission_settlements ADD COLUMN attachment_key TEXT;
ALTER TABLE doctor_commission_settlements ADD COLUMN idempotency_key TEXT;
ALTER TABLE doctor_commission_settlements ADD COLUMN accounting_voucher_id INTEGER REFERENCES accounting_vouchers(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_commission_settlements_no
  ON doctor_commission_settlements(tenant_id, settlement_no)
  WHERE settlement_no IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_commission_settlements_idempotency
  ON doctor_commission_settlements(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_doctor_commission_settlements_accounting_voucher
  ON doctor_commission_settlements(tenant_id, accounting_voucher_id);

CREATE TABLE IF NOT EXISTS doctor_commission_settlement_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  settlement_id INTEGER NOT NULL REFERENCES doctor_commission_settlements(id) ON DELETE CASCADE,
  accrual_id INTEGER NOT NULL REFERENCES doctor_commission_accruals(id) ON DELETE RESTRICT,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL,
  invoice_id INTEGER,
  bill_id INTEGER,
  patient_id INTEGER,
  service_date TEXT,
  gross_amount REAL NOT NULL DEFAULT 0,
  commission_amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, accrual_id)
);

CREATE INDEX IF NOT EXISTS idx_doctor_commission_settlement_items_settlement
  ON doctor_commission_settlement_items(tenant_id, settlement_id);

CREATE INDEX IF NOT EXISTS idx_doctor_commission_settlement_items_doctor_date
  ON doctor_commission_settlement_items(tenant_id, doctor_id, service_date);

-- Expense approval/execution state. Existing rows stay approved+paid by default.
ALTER TABLE expenses ADD COLUMN payee_name TEXT;
ALTER TABLE expenses ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'
  CHECK (approval_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE expenses ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'paid'
  CHECK (payment_status IN ('unpaid', 'paid', 'void'));
ALTER TABLE expenses ADD COLUMN approval_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE expenses ADD COLUMN approval_threshold REAL NOT NULL DEFAULT 1000;
ALTER TABLE expenses ADD COLUMN counter_session_id INTEGER REFERENCES billing_counter_sessions(id);
ALTER TABLE expenses ADD COLUMN cash_movement_id INTEGER REFERENCES cash_drawer_movements(id);
ALTER TABLE expenses ADD COLUMN execution_idempotency_key TEXT;
ALTER TABLE expenses ADD COLUMN executed_by INTEGER REFERENCES users(id);
ALTER TABLE expenses ADD COLUMN executed_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_execution_idempotency
  ON expenses(tenant_id, execution_idempotency_key)
  WHERE execution_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_approval_payment_status
  ON expenses(tenant_id, approval_status, payment_status, date);

-- Transfer destination/acceptance metadata.
ALTER TABLE billing_counter_cash_transfers ADD COLUMN destination_type TEXT NOT NULL DEFAULT 'admin_custody'
  CHECK (destination_type IN ('admin_custody', 'counter_session', 'bank_deposit'));
ALTER TABLE billing_counter_cash_transfers ADD COLUMN destination_counter_id INTEGER REFERENCES billing_counters(id);
ALTER TABLE billing_counter_cash_transfers ADD COLUMN destination_counter_session_id INTEGER REFERENCES billing_counter_sessions(id);
ALTER TABLE billing_counter_cash_transfers ADD COLUMN custody_label TEXT;
ALTER TABLE billing_counter_cash_transfers ADD COLUMN accepted_cash_movement_id INTEGER REFERENCES cash_drawer_movements(id);
ALTER TABLE billing_counter_cash_transfers ADD COLUMN cancelled_by INTEGER REFERENCES users(id);
ALTER TABLE billing_counter_cash_transfers ADD COLUMN cancelled_at TEXT;
ALTER TABLE billing_counter_cash_transfers ADD COLUMN cancel_reason TEXT;


CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_drawer_accepted_transfer_once
  ON cash_drawer_movements(tenant_id, reference_type, reference_id, movement_type)
  WHERE reference_type = 'accepted_cash_transfer' AND movement_type = 'cash_in';

CREATE TABLE IF NOT EXISTS cash_operation_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  petty_cash_auto_approve_limit REAL NOT NULL DEFAULT 1000,
  receipt_required_limit REAL NOT NULL DEFAULT 1000,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id)
);

