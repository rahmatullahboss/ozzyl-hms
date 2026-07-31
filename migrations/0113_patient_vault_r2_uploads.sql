-- =============================================================================
-- HMS Migration 0113: Patient Vault R2 Upload Metadata
-- Adds storage metadata so patient-uploaded vault files can be stored in R2
-- and served back through protected patient routes, while keeping legacy link
-- entries working.
-- =============================================================================

ALTER TABLE global_patient_vault_documents ADD COLUMN storage_key TEXT;
ALTER TABLE global_patient_vault_documents ADD COLUMN file_name TEXT;
ALTER TABLE global_patient_vault_documents ADD COLUMN mime_type TEXT;
ALTER TABLE global_patient_vault_documents ADD COLUMN file_size INTEGER;
ALTER TABLE global_patient_vault_documents ADD COLUMN source_kind TEXT DEFAULT 'external_link';

CREATE INDEX IF NOT EXISTS idx_phv_storage_key ON global_patient_vault_documents(storage_key);
CREATE INDEX IF NOT EXISTS idx_phv_source_kind ON global_patient_vault_documents(source_kind);
