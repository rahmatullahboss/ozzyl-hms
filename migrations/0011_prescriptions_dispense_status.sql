-- Migration: 0011_prescriptions_dispense_status.sql
-- Adds dispense_status to prescriptions for pharmacy dispensing workflow
-- Also adds quantity and dispensed_qty to prescription_items for tracking

ALTER TABLE prescriptions ADD COLUMN dispense_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE prescription_items ADD COLUMN quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE prescription_items ADD COLUMN dispensed_qty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE prescription_items ADD COLUMN medicine_id INTEGER REFERENCES medicines(id);
