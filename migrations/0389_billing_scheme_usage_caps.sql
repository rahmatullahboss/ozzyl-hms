-- 0389: Billing scheme usage caps and application ledger
-- Adds period caps and records applied scheme benefits separately from bill totals.

ALTER TABLE billing_schemes ADD COLUMN max_discount_amount_per_month REAL DEFAULT 0;
ALTER TABLE billing_schemes ADD COLUMN max_discount_amount_per_year REAL DEFAULT 0;

CREATE TABLE billing_scheme_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  scheme_id INTEGER NOT NULL,
  member_id INTEGER,
  patient_id INTEGER,
  bill_id INTEGER,
  allocation_id INTEGER,
  service_category TEXT,
  subtotal REAL DEFAULT 0,
  discount_amount REAL NOT NULL,
  allocation_type TEXT,
  used_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_billing_scheme_usage_scheme_date ON billing_scheme_usage(tenant_id, scheme_id, used_at);
CREATE INDEX idx_billing_scheme_usage_member_date ON billing_scheme_usage(tenant_id, member_id, used_at);
CREATE INDEX idx_billing_scheme_usage_patient_date ON billing_scheme_usage(tenant_id, patient_id, used_at);
CREATE INDEX idx_billing_scheme_usage_bill ON billing_scheme_usage(tenant_id, bill_id);
