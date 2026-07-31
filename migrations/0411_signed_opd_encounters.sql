-- Migration: 0411_signed_opd_encounters.sql
-- Purpose: create a medico-legal signed envelope for completed OPD encounters
-- and support append-only corrections without mutating the original record.

ALTER TABLE encounters ADD COLUMN appointment_id INTEGER;
ALTER TABLE encounters ADD COLUMN form_soap_id INTEGER;
ALTER TABLE encounters ADD COLUMN prescription_id INTEGER;
ALTER TABLE encounters ADD COLUMN order_refs_json TEXT;
ALTER TABLE encounters ADD COLUMN signed_snapshot TEXT;
ALTER TABLE encounters ADD COLUMN snapshot_hash TEXT;
ALTER TABLE encounters ADD COLUMN signed_by INTEGER;
ALTER TABLE encounters ADD COLUMN signed_at TEXT;
ALTER TABLE encounters ADD COLUMN signature_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE encounters ADD COLUMN addendum_count INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_encounters_tenant_appointment_unique
  ON encounters (tenant_id, appointment_id)
  WHERE appointment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_encounters_tenant_signed
  ON encounters (tenant_id, signed_at)
  WHERE signed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS encounter_addenda (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  encounter_id INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  content TEXT NOT NULL,
  previous_snapshot_hash TEXT NOT NULL,
  addendum_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  FOREIGN KEY (encounter_id) REFERENCES encounters(id)
);

CREATE INDEX IF NOT EXISTS idx_encounter_addenda_encounter
  ON encounter_addenda (tenant_id, encounter_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_encounter_addenda_hash
  ON encounter_addenda (tenant_id, encounter_id, addendum_hash);
