-- Migration 0401: Repair doctor settlement item FK after 0391 accrual table rebuild
-- 0391 rebuilt doctor_commission_accruals by renaming the old table first.
-- SQLite carried the dependent doctor_commission_settlement_items FK to
-- doctor_commission_accruals_old_0391, so new payout items can fail FK checks.
-- Keep the previous table as doctor_commission_settlement_items_old_0401 for rollback/audit safety.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS doctor_commission_settlement_items_old_0401;
ALTER TABLE doctor_commission_settlement_items RENAME TO doctor_commission_settlement_items_old_0401;

CREATE TABLE doctor_commission_settlement_items (
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

INSERT INTO doctor_commission_settlement_items (
  id,
  tenant_id,
  settlement_id,
  accrual_id,
  doctor_id,
  source_type,
  invoice_id,
  bill_id,
  patient_id,
  service_date,
  gross_amount,
  commission_amount,
  created_at
)
SELECT
  id,
  tenant_id,
  settlement_id,
  accrual_id,
  doctor_id,
  source_type,
  invoice_id,
  bill_id,
  patient_id,
  service_date,
  gross_amount,
  commission_amount,
  created_at
FROM doctor_commission_settlement_items_old_0401;

CREATE INDEX IF NOT EXISTS idx_doctor_commission_settlement_items_settlement
  ON doctor_commission_settlement_items(tenant_id, settlement_id);

CREATE INDEX IF NOT EXISTS idx_doctor_commission_settlement_items_doctor_date
  ON doctor_commission_settlement_items(tenant_id, doctor_id, service_date);

PRAGMA foreign_keys = ON;
