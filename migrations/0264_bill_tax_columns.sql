-- Migration: Add tax columns to bills and invoice_items
-- Safe: nullable columns, no data loss

ALTER TABLE invoice_items ADD COLUMN tax_amount REAL;
ALTER TABLE bills ADD COLUMN tax_total REAL;
