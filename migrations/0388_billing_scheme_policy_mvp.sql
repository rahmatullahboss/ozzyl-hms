-- 0388: Billing scheme policy MVP
-- Adds policy metadata and auditable eligibility.

ALTER TABLE billing_schemes ADD COLUMN default_price_category_id INTEGER;
ALTER TABLE billing_schemes ADD COLUMN default_discount_source TEXT DEFAULT 'hospital_discount';
ALTER TABLE billing_schemes ADD COLUMN valid_from TEXT;
ALTER TABLE billing_schemes ADD COLUMN valid_to TEXT;
ALTER TABLE billing_schemes ADD COLUMN max_discount_amount_per_bill REAL DEFAULT 0;
ALTER TABLE billing_schemes ADD COLUMN approval_required_over_percent REAL DEFAULT 0;
ALTER TABLE billing_schemes ADD COLUMN requires_reference INTEGER DEFAULT 0;
ALTER TABLE billing_schemes ADD COLUMN is_auto_apply INTEGER DEFAULT 0;

CREATE TABLE billing_scheme_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  scheme_id INTEGER NOT NULL,
  patient_id INTEGER,
  member_code TEXT,
  member_name TEXT,
  relation TEXT,
  valid_from TEXT,
  valid_to TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);

CREATE INDEX idx_billing_scheme_members_tenant_scheme ON billing_scheme_members(tenant_id, scheme_id, status);
CREATE INDEX idx_billing_scheme_members_patient ON billing_scheme_members(tenant_id, patient_id, status);
CREATE UNIQUE INDEX idx_billing_scheme_members_code_unique ON billing_scheme_members(tenant_id, scheme_id, member_code) WHERE member_code IS NOT NULL;
