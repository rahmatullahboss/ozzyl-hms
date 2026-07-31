-- Migration: 0273_prescription_lock_version.sql
-- Adds prescription locking and version history for medico-legal safety

-- ─── Add lock columns to prescriptions ──────────────────────────────────────
ALTER TABLE prescriptions ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE prescriptions ADD COLUMN locked_at TEXT;
ALTER TABLE prescriptions ADD COLUMN locked_by INTEGER;

-- ─── Prescription versions table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prescription_versions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  prescription_id INTEGER NOT NULL REFERENCES prescriptions(id),
  version_number  INTEGER NOT NULL,
  snapshot        TEXT    NOT NULL,       -- JSON of full prescription at time of save
  edited_by       TEXT    NOT NULL,
  edit_reason     TEXT,
  tenant_id       TEXT    NOT NULL,
  created_at      TEXT DEFAULT (datetime('now', '+6 hours'))
);

-- ─── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_prescription_versions_rx ON prescription_versions(prescription_id);
CREATE INDEX IF NOT EXISTS idx_prescription_versions_tenant_rx ON prescription_versions(tenant_id, prescription_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prescription_versions_rx_version ON prescription_versions(prescription_id, version_number);
