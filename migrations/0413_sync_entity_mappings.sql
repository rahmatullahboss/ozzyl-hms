-- Migration: 0413_sync_entity_mappings.sql
-- Purpose: maintain stable patient sync keys and per-hospital-server mappings.
-- Independent SQLite AUTOINCREMENT namespaces must never be treated as globally
-- interchangeable.

ALTER TABLE patients ADD COLUMN sync_key TEXT;

UPDATE patients
SET sync_key = 'uhid:' || UPPER(TRIM(uhid))
WHERE uhid IS NOT NULL
  AND TRIM(uhid) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM patients AS duplicate_patient
    WHERE duplicate_patient.tenant_id = patients.tenant_id
      AND duplicate_patient.id <> patients.id
      AND UPPER(TRIM(duplicate_patient.uhid)) = UPPER(TRIM(patients.uhid))
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_tenant_sync_key
  ON patients (tenant_id, sync_key);

CREATE TABLE IF NOT EXISTS sync_entity_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  local_entity_id TEXT NOT NULL,
  cloud_entity_id TEXT NOT NULL,
  natural_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_entity_mapping_local
  ON sync_entity_mappings (server_id, tenant_id, entity_type, local_entity_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_entity_mapping_cloud
  ON sync_entity_mappings (server_id, tenant_id, entity_type, cloud_entity_id);

CREATE INDEX IF NOT EXISTS idx_sync_entity_mapping_tenant_entity
  ON sync_entity_mappings (tenant_id, entity_type, updated_at);
