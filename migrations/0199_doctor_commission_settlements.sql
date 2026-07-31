-- Migration: 0199_doctor_commission_settlements.sql
-- Description: Adds a settlement table for doctor commissions and links accruals to it.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS doctor_commission_settlements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       TEXT    NOT NULL,
  doctor_id       INTEGER NOT NULL REFERENCES doctors(id),
  settlement_date DATE    DEFAULT CURRENT_DATE,
  total_amount    REAL    NOT NULL DEFAULT 0,
  payment_mode    TEXT    NOT NULL DEFAULT 'cash' 
    CHECK(payment_mode IN ('cash','bank','cheque','card','mobile_banking','other')),
  reference_no    TEXT,
  notes           TEXT,
  voucher_id      INTEGER REFERENCES accounting_vouchers(id),
  created_by      INTEGER,
  created_at      DATETIME DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX IF NOT EXISTS idx_dr_comm_settlements_tenant_doctor
  ON doctor_commission_settlements(tenant_id, doctor_id, settlement_date);

-- Add settlement_id to accruals
ALTER TABLE doctor_commission_accruals ADD COLUMN settlement_id INTEGER REFERENCES doctor_commission_settlements(id);

CREATE INDEX IF NOT EXISTS idx_dr_comm_accruals_settlement
  ON doctor_commission_accruals(tenant_id, settlement_id);
