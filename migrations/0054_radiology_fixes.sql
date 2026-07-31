-- Migration 0054: Radiology review fixes (F-04, F-10)
-- Add is_active + updated_at to dicom_studies, and cancel_remarks to requisitions

-- F-04: Add is_active column to radiology_dicom_studies for soft-delete support
ALTER TABLE radiology_dicom_studies ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE radiology_dicom_studies ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));

-- F-10: Add cancel_remarks column to radiology_requisitions
ALTER TABLE radiology_requisitions ADD COLUMN cancel_remarks TEXT;

-- Add UNIQUE constraint on radiology_number per tenant (F-01 safety net)
CREATE UNIQUE INDEX IF NOT EXISTS idx_radiology_reports_rad_number
  ON radiology_reports (tenant_id, radiology_number)
  WHERE radiology_number IS NOT NULL AND is_active = 1;
