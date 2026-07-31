-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0103: Patient Merge Map — record-level FK tracking
-- Replaces JSON snapshot approach for precise unmerge operations
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS patient_merge_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merge_log_id INTEGER NOT NULL REFERENCES patient_merge_log(id),
  tenant_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  original_patient_id INTEGER NOT NULL,
  target_patient_id INTEGER NOT NULL,
  moved_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_merge_map_log ON patient_merge_map(merge_log_id);
CREATE INDEX IF NOT EXISTS idx_merge_map_record ON patient_merge_map(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_merge_map_tenant ON patient_merge_map(tenant_id, original_patient_id);
