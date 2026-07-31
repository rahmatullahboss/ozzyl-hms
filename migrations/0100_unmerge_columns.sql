-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0100: Add unmerge columns to patient_merge_log
-- Enables reversible patient merges with full audit trail
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE patient_merge_log ADD COLUMN is_unmerged INTEGER NOT NULL DEFAULT 0;
ALTER TABLE patient_merge_log ADD COLUMN unmerged_by INTEGER;
ALTER TABLE patient_merge_log ADD COLUMN unmerged_at TEXT;
ALTER TABLE patient_merge_log ADD COLUMN unmerge_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_merge_log_unmerged ON patient_merge_log(is_unmerged);
