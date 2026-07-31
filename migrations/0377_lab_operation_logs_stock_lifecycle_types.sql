-- Migration: 0377_lab_operation_logs_stock_lifecycle_types.sql
-- Purpose: Allow lab stock lifecycle operation log types written by stock control routes.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS lab_operation_logs_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  log_date          DATE    NOT NULL DEFAULT CURRENT_DATE,
  log_type          TEXT    NOT NULL
    CHECK(log_type IN ('test_performed','reagent_used','film_used','print_made','machine_run','qc_performed','calibration','maintenance','waste_disposed','stock_opened')),
  lab_test_id       INTEGER REFERENCES lab_test_catalog(id),
  consumable_id     INTEGER REFERENCES lab_consumables(id),
  lab_order_id      INTEGER REFERENCES lab_orders(id),
  radiology_req_id  INTEGER REFERENCES radiology_requisitions(id),
  quantity          INTEGER NOT NULL DEFAULT 1,
  machine_id        INTEGER REFERENCES lab_machines(id),
  description       TEXT,
  performed_by      INTEGER,
  tenant_id         INTEGER NOT NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO lab_operation_logs_new (
  id, log_date, log_type, lab_test_id, consumable_id, lab_order_id, radiology_req_id,
  quantity, machine_id, description, performed_by, tenant_id, created_at
)
SELECT
  id, log_date, log_type, lab_test_id, consumable_id, lab_order_id, radiology_req_id,
  quantity, machine_id, description, performed_by, tenant_id, created_at
FROM lab_operation_logs;

DROP TABLE lab_operation_logs;
ALTER TABLE lab_operation_logs_new RENAME TO lab_operation_logs;

CREATE INDEX IF NOT EXISTS idx_lab_op_logs_date     ON lab_operation_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_lab_op_logs_type     ON lab_operation_logs(log_type);
CREATE INDEX IF NOT EXISTS idx_lab_op_logs_test     ON lab_operation_logs(lab_test_id);
CREATE INDEX IF NOT EXISTS idx_lab_op_logs_tenant   ON lab_operation_logs(tenant_id);

PRAGMA foreign_keys = ON;
