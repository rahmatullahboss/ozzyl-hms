-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0105: Global patient identity claim lifecycle
-- Adds explicit claim ownership and tenant/source lineage to global identities
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE global_patient_identity ADD COLUMN claim_status TEXT NOT NULL DEFAULT 'unclaimed';
ALTER TABLE global_patient_identity ADD COLUMN claimed_auth_user_id INTEGER;
ALTER TABLE global_patient_identity ADD COLUMN claimed_at TEXT;
ALTER TABLE global_patient_identity ADD COLUMN created_source TEXT NOT NULL DEFAULT 'hospital';
ALTER TABLE global_patient_identity ADD COLUMN created_tenant_id TEXT;

ALTER TABLE global_patient_auth ADD COLUMN identity_id INTEGER;

ALTER TABLE patients ADD COLUMN global_identity_id INTEGER;

CREATE INDEX idx_gpi_claim_status ON global_patient_identity(claim_status);
CREATE UNIQUE INDEX idx_gpa_identity_id ON global_patient_auth(identity_id) WHERE identity_id IS NOT NULL;
CREATE INDEX idx_patients_global_identity ON patients(global_identity_id);
