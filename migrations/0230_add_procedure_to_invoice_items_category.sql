-- Migration 0230: Add 'procedure' to invoice_items item_category CHECK constraint.
-- visit_services.service_type includes 'procedure' but invoice_items only allowed
-- test, doctor_visit, operation, medicine, admission, other.

ALTER TABLE invoice_items RENAME TO invoice_items_backup;

CREATE TABLE invoice_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id        INTEGER NOT NULL,
  item_category  TEXT    NOT NULL CHECK(item_category IN ('test','doctor_visit','procedure','operation','medicine','admission','other')),
  description    TEXT,
  quantity       INTEGER NOT NULL DEFAULT 1,
  unit_price     INTEGER NOT NULL,
  line_total      INTEGER NOT NULL,
  reference_id   INTEGER,
  status         TEXT    DEFAULT 'active',
  cancelled_by   INTEGER,
  cancelled_at   TEXT,
  cancel_reason  TEXT,
  co_payment_cash_amount INTEGER DEFAULT 0,
  co_payment_credit_amount INTEGER DEFAULT 0,
  is_insurance   INTEGER DEFAULT 0,
  discount_scheme_id INTEGER,
  tenant_id      INTEGER NOT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (bill_id) REFERENCES bills(id)
);

INSERT INTO invoice_items (id, bill_id, item_category, description, quantity, unit_price, line_total, reference_id, status, cancelled_by, cancelled_at, cancel_reason, co_payment_cash_amount, co_payment_credit_amount, is_insurance, discount_scheme_id, tenant_id, created_at)
SELECT id, bill_id, item_category, description, quantity, unit_price, line_total, reference_id, status, cancelled_by, cancelled_at, cancel_reason, co_payment_cash_amount, co_payment_credit_amount, is_insurance, discount_scheme_id, tenant_id, created_at FROM invoice_items_backup;

DROP TABLE invoice_items_backup;