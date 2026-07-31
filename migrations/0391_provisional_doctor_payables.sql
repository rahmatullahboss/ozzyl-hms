-- Migration: provisional operation/procedure doctor payables
-- Expands doctor payable source types. The billing_provisional_items.doctor_payable_amount
-- column is already present in production and fresh schema definitions.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS doctor_commission_rules_old_0391;
ALTER TABLE doctor_commission_rules RENAME TO doctor_commission_rules_old_0391;

CREATE TABLE doctor_commission_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  doctor_id INTEGER NOT NULL,
  service_type TEXT NOT NULL CHECK(service_type IN ('lab_test','consultation_fee','referral','procedure','ipd_round')),
  lab_test_id INTEGER,
  category TEXT,
  incentive_type TEXT NOT NULL DEFAULT 'performer' CHECK(incentive_type IN ('performer','prescriber','referrer')),
  rate_type TEXT NOT NULL DEFAULT 'percent' CHECK(rate_type IN ('percent','flat')),
  rate_value INTEGER NOT NULL DEFAULT 0,
  effective_from TEXT DEFAULT CURRENT_DATE,
  effective_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

INSERT INTO doctor_commission_rules (
  id, tenant_id, doctor_id, service_type, lab_test_id, category, incentive_type, rate_type, rate_value,
  effective_from, effective_to, is_active, notes, created_by, created_at, updated_at
)
SELECT
  id, tenant_id, doctor_id, service_type, lab_test_id, category, COALESCE(incentive_type, 'performer'), rate_type, rate_value,
  effective_from, effective_to, is_active, notes, created_by, created_at, updated_at
FROM doctor_commission_rules_old_0391;

-- Keep the pre-rebuild copy for production safety. Some existing rows have
-- historical FK violations, and D1 enforces those during DROP TABLE.

DROP TABLE IF EXISTS doctor_commission_accruals_old_0391;
ALTER TABLE doctor_commission_accruals RENAME TO doctor_commission_accruals_old_0391;

CREATE TABLE doctor_commission_accruals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  doctor_id INTEGER NOT NULL,
  patient_id INTEGER,
  visit_id INTEGER,
  bill_id INTEGER,
  lab_order_id INTEGER,
  lab_order_item_id INTEGER,
  lab_test_id INTEGER,
  settlement_id INTEGER,
  source_type TEXT NOT NULL CHECK(source_type IN ('lab_test','consultation_fee','referral','procedure','ipd_round')),
  incentive_type TEXT NOT NULL DEFAULT 'performer' CHECK(incentive_type IN ('performer','prescriber','referrer')),
  gross_amount INTEGER NOT NULL DEFAULT 0,
  commission_rule_id INTEGER,
  commission_rate_bps INTEGER NOT NULL DEFAULT 0,
  commission_flat_amount INTEGER NOT NULL DEFAULT 0,
  commission_amount INTEGER NOT NULL DEFAULT 0,
  earned_commission_amount REAL NOT NULL DEFAULT 0,
  doctor_waiver_amount REAL NOT NULL DEFAULT 0,
  payable_commission_amount REAL NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0,
  balance_amount REAL NOT NULL DEFAULT 0,
  waiver_reason TEXT,
  waiver_allocation_id INTEGER,
  status TEXT NOT NULL DEFAULT 'accrued' CHECK(status IN ('accrued','approved','paid','cancelled')),
  accrued_date TEXT DEFAULT CURRENT_DATE,
  paid_date TEXT,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

INSERT INTO doctor_commission_accruals (
  id, tenant_id, doctor_id, patient_id, visit_id, bill_id, lab_order_id, lab_order_item_id, lab_test_id, settlement_id,
  source_type, incentive_type, gross_amount, commission_rule_id, commission_rate_bps, commission_flat_amount, commission_amount,
  earned_commission_amount, doctor_waiver_amount, payable_commission_amount, paid_amount, balance_amount, waiver_reason,
  waiver_allocation_id, status, accrued_date, paid_date, notes, created_by, created_at, updated_at
)
SELECT
  id, tenant_id, doctor_id, patient_id, visit_id, bill_id, lab_order_id, lab_order_item_id, lab_test_id, settlement_id,
  source_type, COALESCE(incentive_type, 'performer'), gross_amount, commission_rule_id, commission_rate_bps, commission_flat_amount, commission_amount,
  COALESCE(earned_commission_amount, commission_amount), COALESCE(doctor_waiver_amount, 0), COALESCE(payable_commission_amount, commission_amount),
  COALESCE(paid_amount, 0), COALESCE(balance_amount, commission_amount), waiver_reason, waiver_allocation_id,
  status, accrued_date, paid_date, notes, created_by, created_at, updated_at
FROM doctor_commission_accruals_old_0391;

-- Keep the pre-rebuild copy for production safety. Some existing rows have
-- historical FK violations, and D1 enforces those during DROP TABLE.

CREATE INDEX IF NOT EXISTS idx_doctor_comm_rules_tenant_doctor ON doctor_commission_rules(tenant_id, doctor_id, service_type, is_active);
CREATE INDEX IF NOT EXISTS idx_doctor_comm_rules_test ON doctor_commission_rules(tenant_id, lab_test_id, is_active);
CREATE INDEX IF NOT EXISTS idx_doctor_comm_rules_dates ON doctor_commission_rules(effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_dc_rules_incentive_type ON doctor_commission_rules(incentive_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_comm_accruals_lab_unique ON doctor_commission_accruals(tenant_id, doctor_id, lab_order_item_id) WHERE source_type = 'lab_test' AND lab_order_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doctor_comm_accruals_tenant_status ON doctor_commission_accruals(tenant_id, status, accrued_date);
CREATE INDEX IF NOT EXISTS idx_doctor_comm_accruals_doctor ON doctor_commission_accruals(tenant_id, doctor_id, accrued_date);
CREATE INDEX IF NOT EXISTS idx_doctor_comm_accruals_bill ON doctor_commission_accruals(tenant_id, bill_id);
CREATE INDEX IF NOT EXISTS idx_dr_comm_accruals_settlement ON doctor_commission_accruals(tenant_id, settlement_id);
CREATE INDEX IF NOT EXISTS idx_dc_accruals_incentive_type ON doctor_commission_accruals(incentive_type);
CREATE INDEX IF NOT EXISTS idx_doctor_comm_accruals_payable_balance ON doctor_commission_accruals(tenant_id, doctor_id, status, balance_amount);

PRAGMA foreign_keys = ON;
