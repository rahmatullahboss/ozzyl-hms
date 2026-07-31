-- Migration 0263: Add prescription_id to consultations table
-- Links prescriptions to consultations for EMR workflow

ALTER TABLE consultations ADD COLUMN prescription_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_consultations_prescription ON consultations(prescription_id);
