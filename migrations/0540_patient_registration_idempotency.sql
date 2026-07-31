-- Migration: 0540_patient_registration_idempotency.sql
-- Durable at-most-once guard for patient registration retries.

ALTER TABLE patients ADD COLUMN registration_idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_tenant_registration_idempotency
  ON patients(tenant_id, registration_idempotency_key)
  WHERE registration_idempotency_key IS NOT NULL
    AND registration_idempotency_key <> '';
