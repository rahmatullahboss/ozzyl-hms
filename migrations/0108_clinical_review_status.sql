ALTER TABLE patient_allergies ADD COLUMN review_status TEXT DEFAULT 'pending_review'
  CHECK (review_status IN ('pending_review', 'verified', 'rejected'));
ALTER TABLE patient_allergies ADD COLUMN reviewed_by INTEGER;
ALTER TABLE patient_allergies ADD COLUMN reviewed_at TEXT;
ALTER TABLE patient_allergies ADD COLUMN review_notes TEXT;

ALTER TABLE patient_active_medications ADD COLUMN review_status TEXT DEFAULT 'pending_review'
  CHECK (review_status IN ('pending_review', 'verified', 'rejected'));
ALTER TABLE patient_active_medications ADD COLUMN reviewed_by INTEGER;
ALTER TABLE patient_active_medications ADD COLUMN reviewed_at TEXT;
ALTER TABLE patient_active_medications ADD COLUMN review_notes TEXT;

ALTER TABLE ClinicalDiagnosis ADD COLUMN review_status TEXT DEFAULT 'verified'
  CHECK (review_status IN ('pending_review', 'verified', 'rejected'));
ALTER TABLE ClinicalDiagnosis ADD COLUMN reviewed_by TEXT;
ALTER TABLE ClinicalDiagnosis ADD COLUMN reviewed_at TEXT;
ALTER TABLE ClinicalDiagnosis ADD COLUMN review_notes TEXT;
