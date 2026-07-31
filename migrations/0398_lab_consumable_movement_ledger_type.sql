-- Migration: 0398_lab_consumable_movement_ledger_type.sql
-- Purpose: separate legacy lab stock references from canonical inventory stock references in lab movement rows.

ALTER TABLE lab_consumable_movements ADD COLUMN ledger_type TEXT DEFAULT 'lab' CHECK(ledger_type IN ('lab', 'inventory'));
ALTER TABLE lab_consumable_movements ADD COLUMN lab_stock_id INTEGER;
ALTER TABLE lab_consumable_movements ADD COLUMN inventory_stock_id INTEGER;

UPDATE lab_consumable_movements
SET ledger_type = 'lab'
WHERE ledger_type IS NULL;

UPDATE lab_consumable_movements
SET lab_stock_id = stock_id
WHERE COALESCE(ledger_type, 'lab') = 'lab'
  AND lab_stock_id IS NULL
  AND stock_id IS NOT NULL;

UPDATE lab_consumable_movements
SET inventory_stock_id = stock_id
WHERE ledger_type = 'inventory'
  AND inventory_stock_id IS NULL
  AND stock_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lab_movements_ledger_stock
  ON lab_consumable_movements(tenant_id, ledger_type, lab_stock_id, inventory_stock_id);

CREATE INDEX IF NOT EXISTS idx_lab_movements_order_item_ledger
  ON lab_consumable_movements(tenant_id, reference_type, reference_id, movement_type, ledger_type);
