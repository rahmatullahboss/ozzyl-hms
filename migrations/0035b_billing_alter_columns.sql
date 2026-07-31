-- Migration: Add cancellation + settlement columns to existing billing tables
-- Run ONLY on production (where bills, invoice_items tables exist)

ALTER TABLE bills ADD COLUMN cancelled_by INTEGER;
ALTER TABLE bills ADD COLUMN cancelled_at TEXT;
ALTER TABLE bills ADD COLUMN cancel_reason TEXT;
ALTER TABLE bills ADD COLUMN settlement_id INTEGER;

ALTER TABLE invoice_items ADD COLUMN status TEXT DEFAULT 'active';
ALTER TABLE invoice_items ADD COLUMN cancelled_by INTEGER;
ALTER TABLE invoice_items ADD COLUMN cancelled_at TEXT;
ALTER TABLE invoice_items ADD COLUMN cancel_reason TEXT;
