-- Migration: Reorder automation config
-- Adds auto-reorder flags and preferred vendor to InventoryItem

ALTER TABLE InventoryItem ADD COLUMN auto_reorder_enabled INTEGER DEFAULT 0;
ALTER TABLE InventoryItem ADD COLUMN preferred_vendor_id INTEGER REFERENCES InventoryVendor(VendorId);
ALTER TABLE InventoryItem ADD COLUMN reorder_quantity_formula TEXT DEFAULT 'max_minus_current' CHECK(reorder_quantity_formula IN ('max_minus_current', 'reorder_x2_minus_current', 'fixed'));
