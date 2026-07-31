-- Migration: 0378_lab_inventory_bridge_links.sql
-- Purpose: Link canonical inventory GRN source records to the lab reagent stock ledger.

ALTER TABLE lab_consumables ADD COLUMN inventory_item_id INTEGER;
ALTER TABLE lab_consumable_stock ADD COLUMN inventory_stock_id INTEGER;
ALTER TABLE lab_consumable_stock ADD COLUMN goods_receipt_item_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_consumables_inventory_item
  ON lab_consumables(tenant_id, inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_consumable_stock_inventory_stock
  ON lab_consumable_stock(tenant_id, inventory_stock_id)
  WHERE inventory_stock_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lab_consumable_stock_gr_item
  ON lab_consumable_stock(tenant_id, goods_receipt_item_id)
  WHERE goods_receipt_item_id IS NOT NULL;
