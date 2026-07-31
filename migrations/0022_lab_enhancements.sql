-- Migration: 0022_lab_enhancements.sql
-- Adds unit, normal_range, method to lab_test_catalog
-- Adds result_numeric, abnormal_flag, sample_status, collected_at, processed_by to lab_order_items

-- ─── Lab Test Catalog enhancements ────────────────────────────────────────────
ALTER TABLE lab_test_catalog ADD COLUMN unit TEXT;           -- 'mg/dL', 'mmol/L', 'g/dL', etc.
ALTER TABLE lab_test_catalog ADD COLUMN normal_range TEXT;   -- '70-100' or 'M:4.5-5.5|F:4.0-5.0'
ALTER TABLE lab_test_catalog ADD COLUMN method TEXT;         -- 'Colorimetric', 'Immunoassay', 'HPLC'

-- ─── Lab Order Items enhancements ─────────────────────────────────────────────
ALTER TABLE lab_order_items ADD COLUMN result_numeric REAL;
ALTER TABLE lab_order_items ADD COLUMN abnormal_flag TEXT DEFAULT 'pending';
ALTER TABLE lab_order_items ADD COLUMN sample_status TEXT DEFAULT 'ordered';
ALTER TABLE lab_order_items ADD COLUMN collected_at DATETIME;
ALTER TABLE lab_order_items ADD COLUMN processed_by INTEGER;

-- Index for sample status filtering
CREATE INDEX IF NOT EXISTS idx_lab_order_items_sample_status ON lab_order_items(sample_status);
CREATE INDEX IF NOT EXISTS idx_lab_order_items_abnormal ON lab_order_items(abnormal_flag);
