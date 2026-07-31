-- Migration: 0003_add_icd10_to_visits.sql
-- Adds ICD-10 diagnosis code fields to the visits table.
-- ICD-10 is required for DGHS (Bangladesh) health reporting.
--
-- Apply locally:  npx wrangler d1 execute DB --local --file=migrations/0003_add_icd10_to_visits.sql
-- Apply staging:  npx wrangler d1 execute DB --env staging --remote --file=migrations/0003_add_icd10_to_visits.sql
-- Apply prod:     npx wrangler d1 execute DB --env production --remote --file=migrations/0003_add_icd10_to_visits.sql

ALTER TABLE visits ADD COLUMN icd10_code TEXT;
ALTER TABLE visits ADD COLUMN icd10_description TEXT;

-- Index for reporting queries (e.g. "all visits diagnosed with J06 this month")
CREATE INDEX IF NOT EXISTS idx_visits_icd10 ON visits(tenant_id, icd10_code);
