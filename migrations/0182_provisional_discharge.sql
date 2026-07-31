-- Migration 0182: Provisional discharge fields
-- Reference: DanpheEMR ProvisionalDischarge feature
-- A doctor can mark a patient as "ready to discharge" so billing/pharmacy can prepare clearance

ALTER TABLE admissions ADD COLUMN provisional_discharge_on TEXT;
ALTER TABLE admissions ADD COLUMN provisional_discharge_by TEXT;
ALTER TABLE admissions ADD COLUMN provisional_discharge_note TEXT;
ALTER TABLE admissions ADD COLUMN is_provisional_discharge INTEGER NOT NULL DEFAULT 0;
