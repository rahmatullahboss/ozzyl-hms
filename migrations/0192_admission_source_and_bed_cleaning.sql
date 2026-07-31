-- Admission source metadata and discharge bed cleaning workflow.

ALTER TABLE admissions ADD COLUMN admit_source TEXT;
ALTER TABLE admissions ADD COLUMN referral_doctor TEXT;
ALTER TABLE admissions ADD COLUMN admission_reason TEXT;
ALTER TABLE admissions ADD COLUMN is_emergency INTEGER NOT NULL DEFAULT 0;

UPDATE admissions
SET admit_source = CASE
  WHEN admission_type = 'emergency' THEN 'emergency'
  WHEN admission_type = 'transfer' THEN 'transfer'
  WHEN admission_type = 'general' THEN 'opd_referral'
  ELSE 'planned'
END
WHERE admit_source IS NULL;

UPDATE admissions
SET is_emergency = 1
WHERE admission_type = 'emergency';
