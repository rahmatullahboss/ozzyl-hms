ALTER TABLE patient_allergies ADD COLUMN source TEXT NOT NULL DEFAULT 'clinician';
ALTER TABLE clinical_vitals ADD COLUMN source TEXT NOT NULL DEFAULT 'recorded';
ALTER TABLE ClinicalDiagnosis ADD COLUMN source TEXT NOT NULL DEFAULT 'clinician';
ALTER TABLE lab_order_items ADD COLUMN source TEXT NOT NULL DEFAULT 'lab';
ALTER TABLE patient_vitals ADD COLUMN source TEXT NOT NULL DEFAULT 'recorded';
ALTER TABLE final_diagnosis ADD COLUMN source TEXT NOT NULL DEFAULT 'clinician';
ALTER TABLE tests ADD COLUMN source TEXT NOT NULL DEFAULT 'lab';
