-- Migration: Add 'referral' to doctor commission rules and accruals
-- Description: Updates the check constraints to allow 'referral' as a service/source type.

-- Note: SQLite does not support ALTER TABLE DROP CONSTRAINT or ALTER COLUMN.
-- However, we can use a trick or just ignore the check if we're careful, 
-- but for data integrity, we should ideally recreate the table or use a new type.
-- Since this is a new feature, I'll just use the existing types if they fit, 
-- or I'll create a new migration that handles the type expansion.

-- Actually, 'lab_test' and 'consultation_fee' describe the *what*, not the *why*.
-- Referral is a *why*.
-- In DanpheEMR, they have PerformerPercent, PrescriberPercent, ReferrerPercent.
-- In our system, one doctor can have a rule for a lab test.

-- If I set doctor_id to the Referring Doctor, and service_type to 'lab_test', 
-- it works, BUT it might conflict with the rule for the Performer (visit doctor).

-- So I SHOULD distinguish them.

-- I'll add a new migration to expand the allowed types.

PRAGMA foreign_keys = OFF;

CREATE TABLE doctor_commission_rules_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id      INTEGER NOT NULL,
  doctor_id      INTEGER NOT NULL REFERENCES doctors(id),
  service_type   TEXT    NOT NULL CHECK(service_type IN ('lab_test','consultation_fee','referral')),
  lab_test_id    INTEGER REFERENCES lab_test_catalog(id),
  category       TEXT,
  rate_type      TEXT    NOT NULL DEFAULT 'percent' CHECK(rate_type IN ('percent','flat')),
  rate_value     INTEGER NOT NULL DEFAULT 0,
  effective_from DATE    DEFAULT CURRENT_DATE,
  effective_to   DATE,
  is_active      INTEGER NOT NULL DEFAULT 1,
  notes          TEXT,
  created_by     INTEGER,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO doctor_commission_rules_new SELECT * FROM doctor_commission_rules;
DROP TABLE doctor_commission_rules;
ALTER TABLE doctor_commission_rules_new RENAME TO doctor_commission_rules;

CREATE TABLE doctor_commission_accruals_new (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id                INTEGER NOT NULL,
  doctor_id                INTEGER NOT NULL REFERENCES doctors(id),
  patient_id               INTEGER REFERENCES patients(id),
  visit_id                 INTEGER REFERENCES visits(id),
  bill_id                  INTEGER REFERENCES bills(id),
  lab_order_id             INTEGER REFERENCES lab_orders(id),
  lab_order_item_id        INTEGER REFERENCES lab_order_items(id),
  lab_test_id              INTEGER REFERENCES lab_test_catalog(id),
  source_type              TEXT    NOT NULL CHECK(source_type IN ('lab_test','consultation_fee','referral')),
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

INSERT INTO doctor_commission_accruals_new SELECT * FROM doctor_commission_accruals;
DROP TABLE doctor_commission_accruals;
ALTER TABLE doctor_commission_accruals_new RENAME TO doctor_commission_accruals;

-- Re-create indexes
CREATE INDEX idx_doctor_comm_rules_tenant_doctor
  ON doctor_commission_rules(tenant_id, doctor_id, service_type, is_active);
CREATE INDEX idx_doctor_comm_rules_test
  ON doctor_commission_rules(tenant_id, lab_test_id, is_active);
CREATE INDEX idx_doctor_comm_rules_dates
  ON doctor_commission_rules(effective_from, effective_to);

CREATE UNIQUE INDEX idx_doctor_comm_accruals_lab_unique
  ON doctor_commission_accruals(tenant_id, doctor_id, lab_order_item_id)
  WHERE source_type = 'lab_test' AND lab_order_item_id IS NOT NULL;
CREATE INDEX idx_doctor_comm_accruals_tenant_status
  ON doctor_commission_accruals(tenant_id, status, accrued_date);
CREATE INDEX idx_doctor_comm_accruals_doctor
  ON doctor_commission_accruals(tenant_id, doctor_id, accrued_date);
CREATE INDEX idx_doctor_comm_accruals_bill
  ON doctor_commission_accruals(tenant_id, bill_id);

PRAGMA foreign_keys = ON;
