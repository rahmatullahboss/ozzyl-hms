-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0104: Fine-grained consent — clinical area scoping
-- Allows patients to grant access to specific data categories (labs, vitals, etc.)
-- NULL = all areas (backward compatible with existing consents)
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE health_record_consents ADD COLUMN clinical_areas TEXT;
-- JSON array: ["labs","prescriptions","vitals","allergies","visits","diagnoses","all"]
-- NULL = "all" (backward compatible)
