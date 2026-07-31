CREATE TABLE IF NOT EXISTS bill_discount_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  bill_id INTEGER NOT NULL,
  bill_item_id INTEGER,
  settlement_id INTEGER,
  allocation_type TEXT NOT NULL,
  discount_reason TEXT NOT NULL DEFAULT 'normal_hospital_discount',
  doctor_id INTEGER,
  amount REAL NOT NULL DEFAULT 0,
  percent REAL,
  reference_name TEXT,
  approval_status TEXT NOT NULL DEFAULT 'recorded',
  approved_by INTEGER,
  note TEXT,
  metadata_json TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX IF NOT EXISTS idx_bill_discount_allocations_bill
  ON bill_discount_allocations(tenant_id, bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_discount_allocations_settlement
  ON bill_discount_allocations(tenant_id, settlement_id);
CREATE INDEX IF NOT EXISTS idx_bill_discount_allocations_doctor
  ON bill_discount_allocations(tenant_id, doctor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bill_discount_allocations_type_date
  ON bill_discount_allocations(tenant_id, allocation_type, created_at);

ALTER TABLE doctor_commission_accruals ADD COLUMN earned_commission_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_accruals ADD COLUMN doctor_waiver_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_accruals ADD COLUMN payable_commission_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_accruals ADD COLUMN paid_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_accruals ADD COLUMN balance_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_accruals ADD COLUMN waiver_reason TEXT;
ALTER TABLE doctor_commission_accruals ADD COLUMN waiver_allocation_id INTEGER;

UPDATE doctor_commission_accruals
SET earned_commission_amount = COALESCE(commission_amount, 0),
    payable_commission_amount = COALESCE(commission_amount, 0),
    balance_amount = CASE WHEN status = 'paid' THEN 0 ELSE COALESCE(commission_amount, 0) END,
    paid_amount = CASE WHEN status = 'paid' THEN COALESCE(commission_amount, 0) ELSE 0 END
WHERE earned_commission_amount = 0
  AND doctor_waiver_amount = 0
  AND payable_commission_amount = 0;

CREATE INDEX IF NOT EXISTS idx_doctor_comm_accruals_payable_balance
  ON doctor_commission_accruals(tenant_id, doctor_id, status, balance_amount);
