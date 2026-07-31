-- Migration: 0412_consultation_completion_claims.sql
-- Purpose: serialize the first OPD completion write for an appointment and make
-- pre-sign SOAP/prescription/diagnosis writes safely resumable after transient
-- failures without allowing concurrent duplicates.

CREATE TABLE IF NOT EXISTS consultation_completion_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  appointment_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER NOT NULL,
  doctor_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'failed', 'completed')),
  lease_token TEXT,
  lease_expires_at TEXT,
  soap_id INTEGER,
  diagnosis_id INTEGER,
  prescription_id INTEGER,
  encounter_id INTEGER,
  last_error_code TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_consultation_completion_claim_appointment
  ON consultation_completion_claims (tenant_id, appointment_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_consultation_completion_claim_key
  ON consultation_completion_claims (tenant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_consultation_completion_claim_lease
  ON consultation_completion_claims (tenant_id, status, lease_expires_at);

ALTER TABLE FormSOAP ADD COLUMN completion_claim_id INTEGER;
ALTER TABLE ClinicalDiagnosis ADD COLUMN completion_claim_id INTEGER;
ALTER TABLE prescriptions ADD COLUMN completion_claim_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_formsoap_completion_claim
  ON FormSOAP (tenant_id, completion_claim_id)
  WHERE completion_claim_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clinical_diagnosis_completion_claim
  ON ClinicalDiagnosis (tenant_id, completion_claim_id)
  WHERE completion_claim_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_prescriptions_completion_claim
  ON prescriptions (tenant_id, completion_claim_id)
  WHERE completion_claim_id IS NOT NULL;
