-- Migration: 0090_patient_duplicate_merge.sql
-- Patient Duplicate Detection & Merge tracking

CREATE TABLE IF NOT EXISTS patient_merge_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    primary_patient_id INTEGER NOT NULL,   -- the surviving record
    merged_patient_id INTEGER NOT NULL,    -- the record that was merged into primary
    merged_data TEXT,                      -- JSON snapshot of merged patient before deletion
    tables_updated TEXT,                   -- JSON: which tables had records moved
    merge_reason TEXT,                     -- "Duplicate NID", "Same phone+name"
    merged_by INTEGER NOT NULL,
    merged_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (primary_patient_id) REFERENCES patients(id)
);
CREATE INDEX IF NOT EXISTS idx_merge_tenant ON patient_merge_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_merge_primary ON patient_merge_log(primary_patient_id);
