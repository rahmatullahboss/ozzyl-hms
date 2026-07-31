-- Allow the transient `verifying` state used to atomically claim a gateway
-- callback/verification request. SQLite cannot alter a CHECK constraint in
-- place, so rebuild the table while preserving every existing row.

PRAGMA foreign_keys = OFF;

CREATE TABLE payment_gateway_logs_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id    TEXT    NOT NULL,
  bill_id      INTEGER NOT NULL,
  gateway      TEXT    NOT NULL CHECK (gateway IN ('bkash', 'nagad')),
  payment_id   TEXT,
  amount       REAL    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'verifying', 'success', 'failed', 'cancelled')),
  raw_response TEXT,
  initiated_by TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO payment_gateway_logs_new (
  id, tenant_id, bill_id, gateway, payment_id, amount, status,
  raw_response, initiated_by, created_at, updated_at
)
SELECT
  id, tenant_id, bill_id, gateway, payment_id, amount, status,
  raw_response, initiated_by, created_at, updated_at
FROM payment_gateway_logs;

DROP TABLE payment_gateway_logs;
ALTER TABLE payment_gateway_logs_new RENAME TO payment_gateway_logs;

CREATE INDEX IF NOT EXISTS idx_pgl_tenant
  ON payment_gateway_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pgl_bill
  ON payment_gateway_logs(tenant_id, bill_id);
CREATE INDEX IF NOT EXISTS idx_pgl_payment
  ON payment_gateway_logs(gateway, payment_id);

PRAGMA foreign_keys = ON;
