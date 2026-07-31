-- Migration: Add barcode columns to food_items table
-- Sprint 3.1 — Task 2: Barcode Scanner Support

ALTER TABLE food_items ADD COLUMN barcode TEXT;
ALTER TABLE food_items ADD COLUMN barcode_type TEXT DEFAULT 'ean13';

-- Index for fast barcode lookups
CREATE INDEX IF NOT EXISTS idx_food_items_barcode ON food_items(barcode);
