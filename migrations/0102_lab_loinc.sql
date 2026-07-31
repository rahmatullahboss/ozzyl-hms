-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0102: Add LOINC code column to lab test catalog
-- Enables FHIR interoperability for lab results
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE lab_test_catalog ADD COLUMN loinc_code TEXT;
CREATE INDEX IF NOT EXISTS idx_lab_test_loinc ON lab_test_catalog(loinc_code);
