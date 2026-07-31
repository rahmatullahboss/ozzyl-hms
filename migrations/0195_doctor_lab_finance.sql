-- =============================================================================
-- HMS Migration: Doctor Lab Finance, Incentive Rules, and Accrual Ledger
-- Date: 2026-05-04
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS doctor_commission_rules (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id      INTEGER NOT NULL,
  doctor_id      INTEGER NOT NULL REFERENCES doctors(id),
  service_type   TEXT    NOT NULL CHECK(service_type IN ('lab_test','consultation_fee')),
  lab_test_id    INTEGER REFERENCES lab_test_catalog(id),
  category       TEXT,
  rate_type      TEXT    NOT NULL DEFAULT 'percent' CHECK(rate_type IN ('percent','flat')),
  rate_value     INTEGER NOT NULL DEFAULT 0, -- percent = basis points, flat = paisa
  effective_from DATE    DEFAULT CURRENT_DATE,
  effective_to   DATE,
  is_active      INTEGER NOT NULL DEFAULT 1,
  notes          TEXT,
  created_by     INTEGER,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_doctor_comm_rules_tenant_doctor
  ON doctor_commission_rules(tenant_id, doctor_id, service_type, is_active);
CREATE INDEX IF NOT EXISTS idx_doctor_comm_rules_test
  ON doctor_commission_rules(tenant_id, lab_test_id, is_active);
CREATE INDEX IF NOT EXISTS idx_doctor_comm_rules_dates
  ON doctor_commission_rules(effective_from, effective_to);

CREATE TABLE IF NOT EXISTS doctor_commission_accruals (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id                INTEGER NOT NULL,
  doctor_id                INTEGER NOT NULL REFERENCES doctors(id),
  patient_id               INTEGER REFERENCES patients(id),
  visit_id                 INTEGER REFERENCES visits(id),
  bill_id                  INTEGER REFERENCES bills(id),
  lab_order_id             INTEGER REFERENCES lab_orders(id),
  lab_order_item_id        INTEGER REFERENCES lab_order_items(id),
  lab_test_id              INTEGER REFERENCES lab_test_catalog(id),
  source_type              TEXT    NOT NULL CHECK(source_type IN ('lab_test','consultation_fee')),
  gross_amount             INTEGER NOT NULL DEFAULT 0,
  commission_rule_id       INTEGER REFERENCES doctor_commission_rules(id),
  commission_rate_bps      INTEGER NOT NULL DEFAULT 0,
  commission_flat_amount   INTEGER NOT NULL DEFAULT 0,
  commission_amount        INTEGER NOT NULL DEFAULT 0,
  status                   TEXT    NOT NULL DEFAULT 'accrued'
    CHECK(status IN ('accrued','approved','paid','cancelled')),
  accrued_date             DATE    DEFAULT CURRENT_DATE,
  paid_date                DATE,
  notes                    TEXT,
  created_by               INTEGER,
  created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_comm_accruals_lab_unique
  ON doctor_commission_accruals(tenant_id, doctor_id, lab_order_item_id)
  WHERE source_type = 'lab_test' AND lab_order_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doctor_comm_accruals_tenant_status
  ON doctor_commission_accruals(tenant_id, status, accrued_date);
CREATE INDEX IF NOT EXISTS idx_doctor_comm_accruals_doctor
  ON doctor_commission_accruals(tenant_id, doctor_id, accrued_date);
CREATE INDEX IF NOT EXISTS idx_doctor_comm_accruals_bill
  ON doctor_commission_accruals(tenant_id, bill_id);
