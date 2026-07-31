-- Link discharge prescriptions to the originating admission and completed
-- medication reconciliation. These nullable columns preserve compatibility
-- with existing OPD prescriptions while providing clinical provenance for IPD
-- transitions of care.

ALTER TABLE prescriptions ADD COLUMN admission_id INTEGER;
ALTER TABLE prescriptions ADD COLUMN source_reconciliation_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_prescriptions_tenant_admission
  ON prescriptions (tenant_id, admission_id)
  WHERE admission_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_prescriptions_tenant_reconciliation_unique
  ON prescriptions (tenant_id, source_reconciliation_id)
  WHERE source_reconciliation_id IS NOT NULL;
