-- ════════════════════════════════════════════════════════════════
-- Sprint 8: Universal Health ID (UHID) System
-- Created: 2026-04-07
-- ════════════════════════════════════════════════════════════════

-- ── 1. Add UHID column to patients ──────────────────────────────
-- Format: OZ-XXXX-XXXXXX (brand prefix + NID checksum + sequence)
-- Globally unique across all tenants.

ALTER TABLE patients ADD COLUMN uhid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_uhid
  ON patients(uhid) WHERE uhid IS NOT NULL;

-- ── 2. UHID sequence counter (global, not per-tenant) ───────────
-- Single-row table for atomic sequence generation.

CREATE TABLE IF NOT EXISTS uhid_sequence (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  last_value INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO uhid_sequence (id, last_value) VALUES (1, 0);

-- ── 3. Add UHID to MPI bridge table ─────────────────────────────

ALTER TABLE patient_health_links ADD COLUMN uhid TEXT;

CREATE INDEX IF NOT EXISTS idx_health_links_uhid
  ON patient_health_links(uhid);

-- ── 4. Emergency access tracking fields ─────────────────────────

ALTER TABLE health_record_consents ADD COLUMN emergency_justification TEXT;
ALTER TABLE health_record_consents ADD COLUMN emergency_declared_by INTEGER;

-- ── 5. Patient global identity table ────────────────────────────
-- Stores the "global patient profile" — one row per NID.
-- Think of it as the patient's "Ozzyl account".

CREATE TABLE IF NOT EXISTS global_patient_identity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  national_id TEXT NOT NULL UNIQUE,
  uhid TEXT NOT NULL UNIQUE,
  primary_name TEXT,
  primary_phone TEXT,
  primary_email TEXT,
  blood_group TEXT,
  date_of_birth TEXT,
  gender TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_global_identity_nid
  ON global_patient_identity(national_id);

CREATE INDEX IF NOT EXISTS idx_global_identity_uhid
  ON global_patient_identity(uhid);
