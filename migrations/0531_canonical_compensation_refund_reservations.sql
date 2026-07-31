-- Canonical doctor-compensation refund reservation and immutable release facts.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_compensation_refund_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  reservation_public_id TEXT NOT NULL,
  accrual_public_id TEXT NOT NULL,
  adjustment_public_id TEXT NOT NULL,
  refund_source_public_id TEXT NOT NULL,
  legacy_approval_request_id INTEGER,
  legacy_accrual_id INTEGER NOT NULL,
  original_base_minor INTEGER NOT NULL,
  reserved_base_minor INTEGER NOT NULL,
  original_earned_minor INTEGER NOT NULL,
  reserved_earned_minor INTEGER NOT NULL,
  original_waiver_minor INTEGER NOT NULL,
  reserved_waiver_minor INTEGER NOT NULL,
  original_payable_minor INTEGER NOT NULL,
  reserved_payable_minor INTEGER NOT NULL,
  paid_minor INTEGER NOT NULL,
  reversal_minor INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'held',
  reversal_public_id TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at_utc TEXT,
  CHECK (length(trim(refund_source_public_id)) > 0),
  CHECK (legacy_approval_request_id IS NULL OR legacy_approval_request_id > 0),
  CHECK (legacy_accrual_id > 0),
  CHECK (original_base_minor BETWEEN 0 AND 9007199254740991),
  CHECK (reserved_base_minor BETWEEN 0 AND original_base_minor),
  CHECK (original_earned_minor BETWEEN 0 AND 9007199254740991),
  CHECK (reserved_earned_minor BETWEEN 0 AND original_earned_minor),
  CHECK (original_waiver_minor BETWEEN 0 AND original_earned_minor),
  CHECK (reserved_waiver_minor BETWEEN 0 AND reserved_earned_minor),
  CHECK (original_payable_minor = original_earned_minor - original_waiver_minor),
  CHECK (reserved_payable_minor = reserved_earned_minor - reserved_waiver_minor),
  CHECK (paid_minor BETWEEN 0 AND reserved_payable_minor),
  CHECK (reversal_minor = original_payable_minor - reserved_payable_minor AND reversal_minor > 0),
  CHECK (status IN ('held','consumed','disputed','released','written_off')),
  CHECK ((status = 'released' AND reversal_public_id IS NOT NULL AND resolved_at_utc IS NOT NULL)
      OR (status <> 'released' AND reversal_public_id IS NULL)),
  CHECK (length(source_evidence_sha256) = 64),
  FOREIGN KEY (tenant_id, accrual_public_id)
    REFERENCES canonical_compensation_accruals(tenant_id, accrual_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, adjustment_public_id)
    REFERENCES canonical_compensation_adjustments(tenant_id, adjustment_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, reservation_public_id),
  UNIQUE (tenant_id, accrual_public_id, refund_source_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_comp_refund_reservation_active
  ON canonical_compensation_refund_reservations(tenant_id, accrual_public_id, status, id);

CREATE INDEX IF NOT EXISTS idx_canonical_comp_refund_reservation_approval
  ON canonical_compensation_refund_reservations(tenant_id, legacy_approval_request_id, status)
  WHERE legacy_approval_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS canonical_compensation_adjustment_reversals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  reversal_public_id TEXT NOT NULL,
  adjustment_public_id TEXT NOT NULL,
  accrual_public_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  reason_code TEXT NOT NULL,
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
  CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  CHECK (length(trim(reason_code)) > 0),
  CHECK (accrual_adjusted_after_minor = accrual_adjusted_before_minor - amount_minor),
  CHECK (accrual_settled_after_minor = accrual_settled_before_minor),
  CHECK (accrual_payable_after_minor = accrual_payable_before_minor + amount_minor),
  CHECK (substr(occurred_at_utc, -1) = 'Z'),
  CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (balance_guard = 1),
  CHECK (length(source_evidence_sha256) = 64),
  FOREIGN KEY (tenant_id, adjustment_public_id)
    REFERENCES canonical_compensation_adjustments(tenant_id, adjustment_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, accrual_public_id)
    REFERENCES canonical_compensation_accruals(tenant_id, accrual_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, reversal_public_id),
  UNIQUE (tenant_id, adjustment_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_comp_adjustment_reversals_accrual
  ON canonical_compensation_adjustment_reversals(tenant_id, accrual_public_id, occurred_at_utc);
