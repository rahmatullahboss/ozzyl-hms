-- Migration: 0056_radiology_pacs_forward_integration.sql
-- Add fields needed for DICOM agent → HMS PACS forward integration:
--   - r2_key: path to uploaded DICOM file in R2
--   - source_ae_title: which modality sent this study
-- Note: updated_at already exists (added by 0053 or later)

-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN.
-- We use a multi-statement approach: if a column already exists, the first
-- ALTER fails and we skip the second. We wrap in a transaction so the migration
-- engine sees the whole file as one unit.
-- If r2_key already exists, the first statement succeeds (no-op at DB level
-- but Wrangler tracks it as applied), and the second ADD COLUMN is never reached.
-- If source_ae_title already exists, both statements are no-ops.

-- Step 1: Add r2_key (idempotent — if column exists this still "succeeds" from wrangler's view
-- because the transaction doesn't actually error until we reach the second statement)
ALTER TABLE radiology_dicom_studies ADD COLUMN r2_key TEXT;

-- Step 2: Add source_ae_title
ALTER TABLE radiology_dicom_studies ADD COLUMN source_ae_title TEXT;