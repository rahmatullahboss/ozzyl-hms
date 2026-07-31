-- Migration: 0373_lab_consumable_stock_qc.sql
-- Purpose: Track QC status for lab reagent/consumable stock lots.

ALTER TABLE lab_consumable_stock ADD COLUMN qc_status TEXT NOT NULL DEFAULT 'not_required' CHECK(qc_status IN ('pending','passed','failed','not_required'));
ALTER TABLE lab_consumable_stock ADD COLUMN qc_checked_at DATETIME;
ALTER TABLE lab_consumable_stock ADD COLUMN qc_checked_by INTEGER;
ALTER TABLE lab_consumable_stock ADD COLUMN qc_remarks TEXT;

CREATE INDEX IF NOT EXISTS idx_lab_consumable_stock_qc
  ON lab_consumable_stock(tenant_id, qc_status, quantity_available);
