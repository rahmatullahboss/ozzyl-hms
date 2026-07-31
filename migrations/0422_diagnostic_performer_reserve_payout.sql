-- =============================================================================
-- HMS Migration: Test-level performer reserve and payout linkage
-- Date: 2026-07-13
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS diagnostic_performer_payout_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  billing_service_item_id INTEGER NOT NULL REFERENCES billing_service_items(id) ON DELETE RESTRICT,
  diagnostic_kind TEXT NOT NULL CHECK (diagnostic_kind IN ('lab', 'radiology')),
  rate_type TEXT NOT NULL CHECK (rate_type IN ('flat', 'percent')),
  rate_value REAL NOT NULL CHECK (rate_value >= 0),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  CHECK (effective_to IS NULL OR date(effective_to) >= date(effective_from)),
  CHECK (rate_type != 'percent' OR rate_value <= 10000)
);

CREATE INDEX IF NOT EXISTS idx_diag_performer_rules_lookup
  ON diagnostic_performer_payout_rules(
    tenant_id, billing_service_item_id, is_active, effective_from, effective_to
  );
CREATE INDEX IF NOT EXISTS idx_diag_performer_rules_kind
  ON diagnostic_performer_payout_rules(tenant_id, diagnostic_kind, is_active);

CREATE TABLE IF NOT EXISTS diagnostic_performer_reserves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  rule_id INTEGER NOT NULL REFERENCES diagnostic_performer_payout_rules(id) ON DELETE RESTRICT,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE RESTRICT,
  invoice_item_id INTEGER NOT NULL REFERENCES invoice_items(id) ON DELETE RESTRICT,
  patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  billing_service_item_id INTEGER NOT NULL REFERENCES billing_service_items(id) ON DELETE RESTRICT,
  diagnostic_kind TEXT NOT NULL CHECK (diagnostic_kind IN ('lab', 'radiology')),
  lab_test_id INTEGER REFERENCES lab_test_catalog(id) ON DELETE SET NULL,
  radiology_imaging_item_id INTEGER REFERENCES radiology_imaging_items(id) ON DELETE SET NULL,
  test_code TEXT,
  test_name TEXT NOT NULL,
  unit_sequence INTEGER NOT NULL CHECK (unit_sequence > 0),
  unit_service_amount REAL NOT NULL CHECK (unit_service_amount >= 0),
  unit_discount_amount REAL NOT NULL DEFAULT 0 CHECK (unit_discount_amount >= 0),
  net_unit_service_amount REAL NOT NULL CHECK (net_unit_service_amount >= 0),
  rule_rate_type TEXT NOT NULL CHECK (rule_rate_type IN ('flat', 'percent')),
  rule_rate_value REAL NOT NULL CHECK (rule_rate_value >= 0),
  reserved_amount REAL NOT NULL CHECK (reserved_amount >= 0),
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'paid', 'cancelled', 'reversed')),
  assigned_doctor_id INTEGER REFERENCES doctors(id) ON DELETE RESTRICT,
  commission_accrual_id INTEGER REFERENCES doctor_commission_accruals(id) ON DELETE RESTRICT,
  settlement_id INTEGER REFERENCES doctor_commission_settlements(id) ON DELETE RESTRICT,
  reserved_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  paid_at TEXT,
  cancelled_at TEXT,
  cancelled_by INTEGER REFERENCES users(id),
  reversed_at TEXT,
  reversed_by INTEGER REFERENCES users(id),
  cancel_reason TEXT,
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, invoice_item_id, unit_sequence)
);

CREATE INDEX IF NOT EXISTS idx_diag_performer_reserves_status
  ON diagnostic_performer_reserves(tenant_id, status, reserved_at);
CREATE INDEX IF NOT EXISTS idx_diag_performer_reserves_service
  ON diagnostic_performer_reserves(tenant_id, billing_service_item_id, status, reserved_at);
CREATE INDEX IF NOT EXISTS idx_diag_performer_reserves_bill
  ON diagnostic_performer_reserves(tenant_id, bill_id, invoice_item_id);
CREATE INDEX IF NOT EXISTS idx_diag_performer_reserves_settlement
  ON diagnostic_performer_reserves(tenant_id, settlement_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_diag_performer_reserve_accrual
  ON diagnostic_performer_reserves(tenant_id, commission_accrual_id)
  WHERE commission_accrual_id IS NOT NULL;

ALTER TABLE doctor_commission_accruals
  ADD COLUMN commission_base_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_accruals
  ADD COLUMN performer_reserve_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_accruals
  ADD COLUMN performer_reserve_id INTEGER;

ALTER TABLE doctor_commission_settlements
  ADD COLUMN reversed_at TEXT;
ALTER TABLE doctor_commission_settlements
  ADD COLUMN reversed_by INTEGER;
ALTER TABLE doctor_commission_settlements
  ADD COLUMN reversal_reason TEXT;
ALTER TABLE doctor_commission_settlements
  ADD COLUMN reversal_voucher_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_doctor_commission_settlements_reversal
  ON doctor_commission_settlements(tenant_id, reversed_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_doctor_commission_accrual_performer_reserve
  ON doctor_commission_accruals(tenant_id, performer_reserve_id)
  WHERE performer_reserve_id IS NOT NULL;
