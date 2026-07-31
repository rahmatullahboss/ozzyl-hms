-- =============================================================================
-- HMS Migration 0026: Lab critical thresholds + queue pagination support
-- Applied: 2026-03-13
-- =============================================================================

-- Add per-test critical thresholds to lab_test_catalog
-- These replace the approximate 2x-range heuristic in detectAbnormalFlag
ALTER TABLE lab_test_catalog ADD COLUMN critical_low  REAL;
ALTER TABLE lab_test_catalog ADD COLUMN critical_high REAL;
