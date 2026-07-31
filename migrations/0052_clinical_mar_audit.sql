-- Migration: 0052_clinical_mar_audit.sql
-- Description: Add updated_by column to clinical MAR tables for audit trail
-- Fixes finding M2 from adversarial review

ALTER TABLE cln_medication_orders ADD COLUMN updated_by INTEGER;
ALTER TABLE cln_medication_reconciliation ADD COLUMN updated_by INTEGER;
ALTER TABLE cln_medication_reconciliation_items ADD COLUMN updated_by INTEGER;
