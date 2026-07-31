-- Migration: 0547_patient_merge_map_hardening.sql
-- Column-aware record map for precise and reversible patient merges.
-- The legacy patient_merge_map table is left untouched for old rollback records.

CREATE TABLE IF NOT EXISTS patient_merge_record_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merge_log_id INTEGER NOT NULL REFERENCES patient_merge_log(id),
  tenant_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  original_patient_id INTEGER NOT NULL,
  target_patient_id INTEGER NOT NULL,
  moved_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_merge_record_map_log
  ON patient_merge_record_map(merge_log_id);
CREATE INDEX IF NOT EXISTS idx_merge_record_map_record
  ON patient_merge_record_map(table_name, column_name, record_id);
CREATE INDEX IF NOT EXISTS idx_merge_record_map_tenant
  ON patient_merge_record_map(tenant_id, original_patient_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_merge_map_unique_record
  ON patient_merge_record_map(merge_log_id, table_name, column_name, record_id);
