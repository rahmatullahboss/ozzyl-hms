-- Canonical practitioner compensation rules, accruals, settlements, and reversals.
-- Triggerless for remote D1/Wrangler compatibility.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_compensation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  rule_public_id TEXT NOT NULL,
  rule_version INTEGER NOT NULL,
  scope_type TEXT NOT NULL,
  service_public_id TEXT,
  category_key TEXT,
  practitioner_public_id TEXT,
  practitioner_role TEXT NOT NULL,
  accrual_stage TEXT NOT NULL,
  rate_type TEXT NOT NULL,
  rate_value INTEGER NOT NULL,
  calculation_basis TEXT NOT NULL,
  discount_treatment TEXT NOT NULL,
  tax_treatment TEXT NOT NULL,
  minimum_minor INTEGER NOT NULL DEFAULT 0,
  cap_minor INTEGER,
  priority INTEGER NOT NULL DEFAULT 100,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_compensation_rules_scope_check CHECK (
    (scope_type='service' AND service_public_id IS NOT NULL AND category_key IS NULL)
    OR (scope_type='category' AND service_public_id IS NULL AND category_key IS NOT NULL)
    OR (scope_type='all' AND service_public_id IS NULL AND category_key IS NULL)
  ),
  CHECK (rule_version > 0),
  CHECK (practitioner_role IN ('performing','referring','prescribing','treating','reporting')),
  CHECK (accrual_stage IN ('performer_reserve','commission','professional_fee')),
  CHECK (rate_type IN ('fixed','basis_points')),
  CHECK (rate_value BETWEEN 0 AND 9007199254740991),
  CHECK (rate_type <> 'basis_points' OR rate_value <= 10000),
  CHECK (calculation_basis IN ('gross','net_after_discount','remaining_after_performer','collected')),
  CHECK (discount_treatment IN ('deduct','ignore')),
  CHECK (tax_treatment IN ('include','exclude')),
  CHECK (minimum_minor BETWEEN 0 AND 9007199254740991),
  CHECK (cap_minor IS NULL OR cap_minor BETWEEN minimum_minor AND 9007199254740991),
  CHECK (priority >= 0),
  CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (effective_to IS NULL OR effective_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (status IN ('active','inactive','retired')),
  CHECK (length(source_evidence_sha256)=64),
  FOREIGN KEY (tenant_id, service_public_id)
    REFERENCES canonical_service_catalog_items(tenant_id, service_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, rule_public_id, rule_version)
);

CREATE INDEX IF NOT EXISTS idx_canonical_compensation_rules_lookup
  ON canonical_compensation_rules(
    tenant_id, scope_type, service_public_id, category_key, practitioner_public_id,
    practitioner_role, status, effective_from, effective_to, priority
  );

CREATE TABLE IF NOT EXISTS canonical_compensation_accruals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  accrual_public_id TEXT NOT NULL,
  invoice_public_id TEXT NOT NULL,
  invoice_line_public_id TEXT NOT NULL,
  service_event_public_id TEXT,
  practitioner_public_id TEXT,
  practitioner_role TEXT NOT NULL,
  accrual_stage TEXT NOT NULL,
  rule_public_id TEXT NOT NULL,
  rule_version INTEGER NOT NULL,
  calculation_basis TEXT NOT NULL,
  rate_type TEXT NOT NULL,
  rate_value INTEGER NOT NULL,
  currency_code TEXT NOT NULL,
  gross_minor INTEGER NOT NULL,
  discount_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL,
  performer_reserve_minor INTEGER NOT NULL,
  eligible_base_minor INTEGER NOT NULL,
  earned_minor INTEGER NOT NULL,
  adjusted_minor INTEGER NOT NULL DEFAULT 0,
  settled_minor INTEGER NOT NULL DEFAULT 0,
  payable_minor INTEGER NOT NULL,
  status TEXT NOT NULL,
  accrued_at_utc TEXT NOT NULL,
  business_date TEXT NOT NULL,
  payable_projection_guard INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (practitioner_role IN ('performing','referring','prescribing','treating','reporting')),
  CHECK (accrual_stage IN ('performer_reserve','commission','professional_fee')),
  CHECK (rule_version > 0),
  CHECK (calculation_basis IN ('gross','net_after_discount','remaining_after_performer','collected')),
  CHECK (rate_type IN ('fixed','basis_points')),
  CHECK (rate_value BETWEEN 0 AND 9007199254740991),
  CHECK (length(currency_code)=3 AND currency_code=upper(currency_code)),
  CHECK (gross_minor BETWEEN 0 AND 9007199254740991),
  CHECK (discount_minor BETWEEN 0 AND gross_minor),
  CHECK (tax_minor BETWEEN 0 AND 9007199254740991),
  CHECK (performer_reserve_minor BETWEEN 0 AND gross_minor),
  CHECK (eligible_base_minor BETWEEN 0 AND 9007199254740991),
  CHECK (earned_minor BETWEEN 0 AND 9007199254740991),
  CHECK (adjusted_minor BETWEEN 0 AND earned_minor),
  CHECK (settled_minor BETWEEN 0 AND earned_minor-adjusted_minor),
  CHECK (payable_minor BETWEEN 0 AND 9007199254740991),
  CONSTRAINT canonical_compensation_accruals_payable_projection_guard CHECK (
    payable_projection_guard=1
    AND payable_minor=earned_minor-adjusted_minor-settled_minor
  ),
  CHECK (status IN ('unassigned','accrued','partially_settled','settled','reversed')),
  CHECK (
    (status='unassigned' AND practitioner_public_id IS NULL AND settled_minor=0)
    OR (status='accrued' AND practitioner_public_id IS NOT NULL AND settled_minor=0 AND payable_minor>0)
    OR (status='partially_settled' AND practitioner_public_id IS NOT NULL AND settled_minor>0 AND payable_minor>0)
    OR (status='settled' AND practitioner_public_id IS NOT NULL AND payable_minor=0)
    OR (status='reversed' AND payable_minor=0)
  ),
  CHECK (substr(accrued_at_utc,-1)='Z'),
  CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (length(source_evidence_sha256)=64),
  FOREIGN KEY (tenant_id, invoice_public_id, invoice_line_public_id)
    REFERENCES canonical_invoice_lines(tenant_id, invoice_public_id, line_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, service_event_public_id)
    REFERENCES canonical_service_events(tenant_id, event_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, rule_public_id, rule_version)
    REFERENCES canonical_compensation_rules(tenant_id, rule_public_id, rule_version) ON DELETE RESTRICT,
  UNIQUE (tenant_id, accrual_public_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_compensation_accruals_assigned
  ON canonical_compensation_accruals(
    tenant_id, invoice_line_public_id, practitioner_public_id,
    practitioner_role, rule_public_id, rule_version
  ) WHERE practitioner_public_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_compensation_accruals_unassigned
  ON canonical_compensation_accruals(
    tenant_id, invoice_line_public_id, practitioner_role, rule_public_id, rule_version
  ) WHERE practitioner_public_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_canonical_compensation_accruals_payable
  ON canonical_compensation_accruals(tenant_id, practitioner_public_id, status, business_date);

CREATE TABLE IF NOT EXISTS canonical_compensation_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  settlement_public_id TEXT NOT NULL,
  settlement_number TEXT NOT NULL,
  practitioner_public_id TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  total_minor INTEGER NOT NULL,
  allocated_minor INTEGER NOT NULL,
  reversed_minor INTEGER NOT NULL DEFAULT 0,
  net_paid_minor INTEGER NOT NULL,
  status TEXT NOT NULL,
  settled_at_utc TEXT NOT NULL,
  business_date TEXT NOT NULL,
  reversed_at_utc TEXT,
  settlement_projection_guard INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (length(trim(settlement_number))>0),
  CHECK (length(currency_code)=3 AND currency_code=upper(currency_code)),
  CHECK (payment_method IN ('cash','bank_transfer','mobile_wallet','card','other')),
  CHECK (total_minor BETWEEN 1 AND 9007199254740991),
  CHECK (allocated_minor=total_minor),
  CHECK (reversed_minor BETWEEN 0 AND total_minor),
  CONSTRAINT canonical_compensation_settlements_settlement_projection_guard CHECK (
    settlement_projection_guard=1 AND net_paid_minor=total_minor-reversed_minor
  ),
  CHECK (status IN ('posted','partially_reversed','reversed')),
  CHECK (
    (status='posted' AND reversed_minor=0 AND reversed_at_utc IS NULL)
    OR (status='partially_reversed' AND reversed_minor>0 AND reversed_minor<total_minor AND reversed_at_utc IS NOT NULL)
    OR (status='reversed' AND reversed_minor=total_minor AND reversed_at_utc IS NOT NULL)
  ),
  CHECK (substr(settled_at_utc,-1)='Z'),
  CHECK (reversed_at_utc IS NULL OR substr(reversed_at_utc,-1)='Z'),
  CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (length(source_evidence_sha256)=64),
  FOREIGN KEY (tenant_id, practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, settlement_public_id),
  UNIQUE (tenant_id, settlement_number)
);

CREATE INDEX IF NOT EXISTS idx_canonical_compensation_settlements_practitioner
  ON canonical_compensation_settlements(tenant_id, practitioner_public_id, status, business_date);

CREATE TABLE IF NOT EXISTS canonical_compensation_settlement_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  allocation_public_id TEXT NOT NULL,
  settlement_public_id TEXT NOT NULL,
  accrual_public_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  reversed_minor INTEGER NOT NULL DEFAULT 0,
  remaining_minor INTEGER NOT NULL,
  accrual_settled_before_minor INTEGER NOT NULL,
  accrual_settled_after_minor INTEGER NOT NULL,
  accrual_payable_before_minor INTEGER NOT NULL,
  accrual_payable_after_minor INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  allocated_at_utc TEXT NOT NULL,
  reversed_at_utc TEXT,
  balance_guard INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  CHECK (reversed_minor BETWEEN 0 AND amount_minor),
  CHECK (remaining_minor=amount_minor-reversed_minor),
  CHECK (accrual_settled_after_minor=accrual_settled_before_minor+amount_minor),
  CHECK (accrual_payable_after_minor=accrual_payable_before_minor-amount_minor),
  CHECK (balance_guard=1),
  CHECK (status IN ('active','partially_reversed','reversed')),
  CHECK (
    (status='active' AND reversed_minor=0 AND reversed_at_utc IS NULL)
    OR (status='partially_reversed' AND reversed_minor>0 AND reversed_minor<amount_minor AND reversed_at_utc IS NOT NULL)
    OR (status='reversed' AND reversed_minor=amount_minor AND reversed_at_utc IS NOT NULL)
  ),
  CHECK (substr(allocated_at_utc,-1)='Z'),
  CHECK (reversed_at_utc IS NULL OR substr(reversed_at_utc,-1)='Z'),
  CHECK (length(source_evidence_sha256)=64),
  FOREIGN KEY (tenant_id, settlement_public_id)
    REFERENCES canonical_compensation_settlements(tenant_id, settlement_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, accrual_public_id)
    REFERENCES canonical_compensation_accruals(tenant_id, accrual_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, allocation_public_id),
  UNIQUE (tenant_id, settlement_public_id, accrual_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_compensation_settlement_allocations_accrual
  ON canonical_compensation_settlement_allocations(tenant_id, accrual_public_id, status);

CREATE TABLE IF NOT EXISTS canonical_compensation_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  adjustment_public_id TEXT NOT NULL,
  accrual_public_id TEXT NOT NULL,
  settlement_public_id TEXT,
  settlement_allocation_public_id TEXT,
  adjustment_type TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  accrual_adjusted_before_minor INTEGER NOT NULL,
  accrual_adjusted_after_minor INTEGER NOT NULL,
  accrual_settled_before_minor INTEGER NOT NULL,
  accrual_settled_after_minor INTEGER NOT NULL,
  accrual_payable_before_minor INTEGER NOT NULL,
  accrual_payable_after_minor INTEGER NOT NULL,
  occurred_at_utc TEXT NOT NULL,
  business_date TEXT NOT NULL,
  balance_guard INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (adjustment_type IN ('credit','refund','service_cancellation','settlement_reversal','manual_recovery')),
  CHECK (length(trim(reason_code))>0),
  CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  CHECK (balance_guard=1),
  CHECK (
    (adjustment_type<>'settlement_reversal'
      AND settlement_public_id IS NULL AND settlement_allocation_public_id IS NULL
      AND accrual_adjusted_after_minor=accrual_adjusted_before_minor+amount_minor
      AND accrual_settled_after_minor=accrual_settled_before_minor
      AND accrual_payable_after_minor=accrual_payable_before_minor-amount_minor)
    OR (adjustment_type='settlement_reversal'
      AND settlement_public_id IS NOT NULL AND settlement_allocation_public_id IS NOT NULL
      AND accrual_adjusted_after_minor=accrual_adjusted_before_minor
      AND accrual_settled_after_minor=accrual_settled_before_minor-amount_minor
      AND accrual_payable_after_minor=accrual_payable_before_minor+amount_minor)
  ),
  CHECK (substr(occurred_at_utc,-1)='Z'),
  CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (length(source_evidence_sha256)=64),
  FOREIGN KEY (tenant_id, accrual_public_id)
    REFERENCES canonical_compensation_accruals(tenant_id, accrual_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, settlement_public_id)
    REFERENCES canonical_compensation_settlements(tenant_id, settlement_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, settlement_allocation_public_id)
    REFERENCES canonical_compensation_settlement_allocations(tenant_id, allocation_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, adjustment_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_compensation_adjustments_accrual
  ON canonical_compensation_adjustments(tenant_id, accrual_public_id, occurred_at_utc);
