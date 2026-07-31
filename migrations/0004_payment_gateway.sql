-- Migration: 0004_payment_gateway.sql
-- Adds payment gateway logging table for bKash and Nagad online payments.
--
-- Apply locally:  npx wrangler d1 execute DB --local --file=migrations/0004_payment_gateway.sql
-- Apply staging:  npx wrangler d1 execute DB --env staging --remote --file=migrations/0004_payment_gateway.sql
-- Apply prod:     npx wrangler d1 execute DB --env production --remote --file=migrations/0004_payment_gateway.sql

CREATE TABLE IF NOT EXISTS payment_gateway_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id    TEXT    NOT NULL,
  bill_id      INTEGER NOT NULL,
  gateway      TEXT    NOT NULL CHECK (gateway IN ('bkash', 'nagad')),
  payment_id   TEXT,               -- gateway-assigned ID (bKash paymentID / Nagad payment_ref_id)
  amount       REAL    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'cancelled')),
  raw_response TEXT,               -- full JSON from gateway (for audit)
  initiated_by TEXT,               -- userId who clicked "Pay Online"
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pgl_tenant    ON payment_gateway_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pgl_bill      ON payment_gateway_logs(tenant_id, bill_id);
CREATE INDEX IF NOT EXISTS idx_pgl_payment   ON payment_gateway_logs(gateway, payment_id);
