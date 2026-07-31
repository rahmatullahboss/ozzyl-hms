-- Migration: 0010_lab_order_clinical_fields.sql
-- Adds clinical info columns to lab_orders and priority/instructions to lab_order_items

ALTER TABLE lab_orders ADD COLUMN status TEXT NOT NULL DEFAULT 'sent';
ALTER TABLE lab_orders ADD COLUMN diagnosis TEXT;
ALTER TABLE lab_orders ADD COLUMN relevant_history TEXT;
ALTER TABLE lab_orders ADD COLUMN fasting_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lab_orders ADD COLUMN specimen_type TEXT DEFAULT 'Blood';
ALTER TABLE lab_orders ADD COLUMN collection_notes TEXT;

ALTER TABLE lab_order_items ADD COLUMN priority TEXT NOT NULL DEFAULT 'routine';
ALTER TABLE lab_order_items ADD COLUMN instructions TEXT;
