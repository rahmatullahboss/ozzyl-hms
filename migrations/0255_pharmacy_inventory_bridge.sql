-- Migration: Pharmacy-Inventory Bridge
-- Links pharmacy_items ↔ InventoryItem, pharmacy_suppliers ↔ InventoryVendor

-- Bridge FK: pharmacy_items → InventoryItem
ALTER TABLE pharmacy_items ADD COLUMN inventory_item_id INTEGER;
-- Bridge FK: InventoryItem → pharmacy_items
ALTER TABLE InventoryItem ADD COLUMN pharmacy_item_id INTEGER;
-- Bridge FK: pharmacy_suppliers → InventoryVendor
ALTER TABLE pharmacy_suppliers ADD COLUMN vendor_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_pharmacy_items_inventory_item_id ON pharmacy_items(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_InventoryItem_pharmacy_item_id ON InventoryItem(pharmacy_item_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_suppliers_vendor_id ON pharmacy_suppliers(vendor_id);
