-- Migration: 0374_lab_consumable_stock_onboard_expiry.sql
-- Purpose: Track open-vial/onboard stability expiry for lab consumable stock lots.

ALTER TABLE lab_consumable_stock ADD COLUMN opened_at DATETIME;
ALTER TABLE lab_consumable_stock ADD COLUMN opened_by INTEGER;
ALTER TABLE lab_consumable_stock ADD COLUMN onboard_expiry_days INTEGER;
ALTER TABLE lab_consumable_stock ADD COLUMN onboard_expires_at DATETIME;
ALTER TABLE lab_consumable_stock ADD COLUMN opened_remarks TEXT;

CREATE INDEX IF NOT EXISTS idx_lab_consumable_stock_onboard_expiry
  ON lab_consumable_stock(tenant_id, onboard_expires_at, quantity_available);
