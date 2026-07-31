-- Migration: 0519_live_doctor_compensation_dual_write.sql
-- Purpose: provide a stable tenant-scoped source identity for atomic legacy/canonical doctor compensation dual-write.

ALTER TABLE doctor_commission_accruals
  ADD COLUMN canonical_source_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_doctor_commission_accrual_canonical_source_key
  ON doctor_commission_accruals(tenant_id, canonical_source_key)
  WHERE canonical_source_key IS NOT NULL;

ALTER TABLE diagnostic_performer_reserves
  ADD COLUMN canonical_source_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_diagnostic_performer_reserve_canonical_source_key
  ON diagnostic_performer_reserves(tenant_id, canonical_source_key)
  WHERE canonical_source_key IS NOT NULL;

DROP INDEX IF EXISTS uq_canonical_compensation_accruals_assigned;
DROP INDEX IF EXISTS uq_canonical_compensation_accruals_unassigned;

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_compensation_accruals_assigned
  ON canonical_compensation_accruals(
    tenant_id, invoice_line_public_id, practitioner_public_id,
    practitioner_role, rule_public_id, rule_version, source_evidence_sha256
  ) WHERE practitioner_public_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_compensation_accruals_unassigned
  ON canonical_compensation_accruals(
    tenant_id, invoice_line_public_id, practitioner_role,
    rule_public_id, rule_version, source_evidence_sha256
  ) WHERE practitioner_public_id IS NULL;
