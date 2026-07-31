-- Guard scheme usage ledger from duplicate bill-level inserts on retries.
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_scheme_usage_bill_scheme_unique
  ON billing_scheme_usage (tenant_id, bill_id, scheme_id)
  WHERE bill_id IS NOT NULL;
