-- Migration 0352: CSSD sterilization release governance
-- Adds explicit indicator-checked columns so we can audit who released a
-- sterilization cycle and when, and ensures downstream code can require the
-- biological indicator to have passed before marking items sterile.

ALTER TABLE cssd_sterilization_cycles ADD COLUMN indicator_passed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cssd_sterilization_cycles ADD COLUMN indicator_checked_by INTEGER;
ALTER TABLE cssd_sterilization_cycles ADD COLUMN indicator_checked_at TEXT;
CREATE INDEX IF NOT EXISTS idx_cssd_cycle_indicator
  ON cssd_sterilization_cycles(tenant_id, indicator_passed);
