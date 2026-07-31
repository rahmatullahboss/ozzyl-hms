-- =============================================================================
-- HMS Migration 0095: B2C Digital Health Card & Patient Vault (Phase 1)
-- Introduces verification levels, vault for historical documents, and 
-- patient-reported clinical data structures matching FHIR standards.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Identity Verification Extensions
-- ─────────────────────────────────────────────────────────────────────────────
-- Add columns to global_patient_identity to track profile completeness.
-- verification_level: 0=Unverified, 1=Self-Declared, 2=Staff-Verified
ALTER TABLE global_patient_identity ADD COLUMN verification_level INTEGER DEFAULT 0;
ALTER TABLE global_patient_identity ADD COLUMN nid_front_url TEXT; 
ALTER TABLE global_patient_identity ADD COLUMN nid_back_url TEXT;
ALTER TABLE global_patient_identity ADD COLUMN profile_picture_url TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Patient Health Vault (PHV)
-- ─────────────────────────────────────────────────────────────────────────────
-- Store scanned docs, imagery, PDFs uploaded directly by patients.
CREATE TABLE IF NOT EXISTS global_patient_vault_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uhid TEXT NOT NULL,
  document_url TEXT NOT NULL,          -- R2 storage URL
  document_type TEXT NOT NULL,         -- 'prescription', 'lab_report', 'discharge_summary', 'other'
  document_date TEXT,                  -- Self-reported date of the document
  title TEXT ,           -- User-provided title
  notes TEXT,
  entered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uhid) REFERENCES global_patient_identity(uhid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_phv_uhid ON global_patient_vault_documents(uhid);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Patient-Reported Clinical Data (PRD)
-- ─────────────────────────────────────────────────────────────────────────────
-- Aligning with FHIR conventions for Condition/AllergyIntolerance reported by patient.
-- verification_status: 'unconfirmed', 'provisional', 'differential', 'confirmed', 'refuted', 'entered-in-error'
CREATE TABLE IF NOT EXISTS global_patient_reported_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uhid TEXT NOT NULL,
  
  category TEXT NOT NULL CHECK(category IN ('allergy', 'chronic_condition', 'current_medication')),
  name TEXT NOT NULL,                         -- Example: "Penicillin", "Diabetes Type 2"
  severity TEXT,                              -- Used mainly for allergies ('mild', 'moderate', 'severe')
  clinical_status TEXT DEFAULT 'active',      -- 'active', 'inactive', 'resolved'
  verification_status TEXT DEFAULT 'unconfirmed', -- FHIR alignment: Patient-reported starts unconfirmed
  
  start_date TEXT,                            -- When did this condition/medication start
  notes TEXT,                                 -- Free text description by patient
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (uhid) REFERENCES global_patient_identity(uhid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_prd_uhid ON global_patient_reported_data(uhid);
CREATE INDEX IF NOT EXISTS idx_prd_category ON global_patient_reported_data(category);

