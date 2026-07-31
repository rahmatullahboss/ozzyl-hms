-- F-09 FIX: Add UNIQUE constraint on (tenant_id, study_instance_uid) for DICOM studies
-- F-10 FIX: Add cancel_remarks to base schema for clean installs

-- Drop old non-unique index
DROP INDEX IF EXISTS idx_rad_dicom_uid;

-- Create tenant-scoped UNIQUE index for DICOM study UIDs
CREATE UNIQUE INDEX IF NOT EXISTS idx_rad_dicom_uid_unique
  ON radiology_dicom_studies(tenant_id, study_instance_uid);
