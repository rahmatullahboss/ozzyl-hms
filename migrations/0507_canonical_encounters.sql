-- =============================================================================
-- HMS Canonical Encounter Foundation (D1 / SQLite)
-- Additive-only encounter, participant, admission-link, and bed-stay structures.
-- Legacy appointments, visits, consultations, encounters, admissions, and beds
-- remain unchanged and authoritative until their explicit cutover waves.
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_encounters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  legacy_patient_id INTEGER NOT NULL,
  encounter_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at_utc TEXT NOT NULL,
  ended_at_utc TEXT,
  signed_snapshot_sha256 TEXT,
  signed_at_utc TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (encounter_type IN ('outpatient', 'inpatient', 'teleconsultation', 'emergency', 'other')),
  CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled', 'unknown')),
  CHECK (ended_at_utc IS NULL OR ended_at_utc >= started_at_utc),
  CHECK (signed_snapshot_sha256 IS NULL OR length(signed_snapshot_sha256) = 64),
  UNIQUE (tenant_id, encounter_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_encounters_patient_time
  ON canonical_encounters(tenant_id, legacy_patient_id, started_at_utc, encounter_public_id);
CREATE INDEX IF NOT EXISTS idx_canonical_encounters_type_status
  ON canonical_encounters(tenant_id, encounter_type, status, started_at_utc);
CREATE INDEX IF NOT EXISTS idx_canonical_encounters_signed
  ON canonical_encounters(tenant_id, signed_at_utc, encounter_public_id);

CREATE TABLE IF NOT EXISTS canonical_encounter_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  practitioner_public_id TEXT NOT NULL,
  participant_role TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  active_from_utc TEXT,
  active_to_utc TEXT,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (participant_role IN (
    'treating', 'consulting', 'admitting', 'referring', 'prescribing',
    'performing', 'reporting', 'approving'
  )),
  CHECK (evidence_type IN (
    'legacy_encounter_provider', 'legacy_visit_doctor',
    'legacy_consultation_doctor', 'legacy_admission_doctor', 'approved_manual'
  )),
  CHECK (active_to_utc IS NULL OR active_from_utc IS NULL OR active_to_utc >= active_from_utc),
  FOREIGN KEY (tenant_id, encounter_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, encounter_public_id, practitioner_public_id, participant_role, evidence_type)
);

CREATE INDEX IF NOT EXISTS idx_canonical_encounter_participants_role
  ON canonical_encounter_participants(tenant_id, practitioner_public_id, participant_role, encounter_public_id);

CREATE TABLE IF NOT EXISTS canonical_encounter_admission_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  legacy_admission_id INTEGER NOT NULL,
  admission_no TEXT NOT NULL,
  link_status TEXT NOT NULL DEFAULT 'active',
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (link_status IN ('active', 'retired', 'rejected')),
  FOREIGN KEY (tenant_id, encounter_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, legacy_admission_id),
  UNIQUE (tenant_id, admission_no),
  UNIQUE (tenant_id, encounter_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_encounter_admission_links_status
  ON canonical_encounter_admission_links(tenant_id, link_status, legacy_admission_id);

CREATE TABLE IF NOT EXISTS canonical_encounter_addenda (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  addendum_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  legacy_addendum_id INTEGER NOT NULL,
  previous_snapshot_sha256 TEXT,
  addendum_sha256 TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (previous_snapshot_sha256 IS NULL OR length(previous_snapshot_sha256) = 64),
  CHECK (length(addendum_sha256) = 64),
  FOREIGN KEY (tenant_id, encounter_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, addendum_public_id),
  UNIQUE (tenant_id, legacy_addendum_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_encounter_addenda_encounter
  ON canonical_encounter_addenda(tenant_id, encounter_public_id, created_at_utc, addendum_public_id);

CREATE TABLE IF NOT EXISTS canonical_bed_stays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  bed_stay_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  legacy_patient_bed_info_id INTEGER NOT NULL,
  legacy_admission_id INTEGER NOT NULL,
  legacy_bed_id INTEGER NOT NULL,
  started_at_utc TEXT NOT NULL,
  ended_at_utc TEXT,
  status TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (status IN ('active', 'completed', 'invalid')),
  CHECK (ended_at_utc IS NULL OR ended_at_utc >= started_at_utc),
  FOREIGN KEY (tenant_id, encounter_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, bed_stay_public_id),
  UNIQUE (tenant_id, legacy_patient_bed_info_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_bed_stays_encounter_time
  ON canonical_bed_stays(tenant_id, encounter_public_id, started_at_utc, bed_stay_public_id);
CREATE INDEX IF NOT EXISTS idx_canonical_bed_stays_bed_time
  ON canonical_bed_stays(tenant_id, legacy_bed_id, started_at_utc, ended_at_utc);
