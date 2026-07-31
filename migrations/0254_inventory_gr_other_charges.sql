-- Migration: 0254_inventory_gr_other_charges.sql
-- Purpose: Add freight, insurance, and other charges columns to InventoryGoodsReceipt for accurate landed cost calculation.

ALTER TABLE InventoryGoodsReceipt ADD COLUMN FreightAmount REAL DEFAULT 0;
ALTER TABLE InventoryGoodsReceipt ADD COLUMN InsuranceAmount REAL DEFAULT 0;
ALTER TABLE InventoryGoodsReceipt ADD COLUMN OtherCharges REAL DEFAULT 0;
