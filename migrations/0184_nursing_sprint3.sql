-- Migration: 0184_nursing_sprint3.sql
-- Sprint 3: Nursing UX enhancements
-- 5.1 Chief complaint on visits
-- 5.4 Favourite patients
-- 5.7 SBAR handover columns

-- ── 5.1 Chief complaint at check-in ──────────────────────────────────────────
ALTER TABLE visits ADD COLUMN chief_complaint TEXT;

-- ── 5.4 Favourite patients ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nursing_favourite_patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    nurse_user_id TEXT NOT NULL,
    patient_id INTEGER NOT NULL,
    added_on TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tenant_id, nurse_user_id, patient_id)
);
CREATE INDEX IF NOT EXISTS idx_nfp_tenant_nurse ON nursing_favourite_patients(tenant_id, nurse_user_id);
CREATE INDEX IF NOT EXISTS idx_nfp_tenant_patient ON nursing_favourite_patients(tenant_id, patient_id);

-- ── 5.7 SBAR handover structured fields ──────────────────────────────────────
ALTER TABLE nur_handover ADD COLUMN situation TEXT;
ALTER TABLE nur_handover ADD COLUMN background TEXT;
ALTER TABLE nur_handover ADD COLUMN assessment TEXT;
ALTER TABLE nur_handover ADD COLUMN recommendation TEXT;
