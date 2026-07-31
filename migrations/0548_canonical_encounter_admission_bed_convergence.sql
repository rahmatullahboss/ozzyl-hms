-- Migration: 0548_canonical_encounter_admission_bed_convergence.sql
-- Purpose: harden canonical encounter identity and add canonical admission,
--          care-location, bed-resource, and public-ID bed-stay authority.
-- Safety: additive logical authority; legacy source IDs remain compatibility evidence.

PRAGMA foreign_keys = OFF;
PRAGMA legacy_alter_table = ON;

CREATE TABLE IF NOT EXISTS canonical_care_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  location_public_id TEXT NOT NULL,
  parent_location_public_id TEXT,
  location_kind TEXT NOT NULL,
  location_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  operational_status TEXT NOT NULL DEFAULT 'active',
  timezone TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (tenant_id, location_public_id),
  FOREIGN KEY (tenant_id, parent_location_public_id)
    REFERENCES canonical_care_locations(tenant_id, location_public_id)
    ON DELETE RESTRICT,
  CHECK (parent_location_public_id IS NULL OR parent_location_public_id <> location_public_id),
  CHECK (location_kind IN ('facility','branch','floor','ward','room','care_area','other')),
  CHECK (operational_status IN ('active','inactive','retired')),
  CHECK (length(trim(location_code)) > 0),
  CHECK (length(trim(display_name)) > 0),
  CHECK (length(trim(timezone)) > 0),
  CHECK (version > 0),
  CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_care_locations_root_code
  ON canonical_care_locations(tenant_id, location_code)
  WHERE parent_location_public_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_care_locations_child_code
  ON canonical_care_locations(tenant_id, parent_location_public_id, location_code)
  WHERE parent_location_public_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_care_locations_parent
  ON canonical_care_locations(tenant_id, parent_location_public_id, operational_status, location_public_id);

CREATE INDEX IF NOT EXISTS idx_canonical_care_locations_kind_status
  ON canonical_care_locations(tenant_id, location_kind, operational_status, location_code);

CREATE TABLE IF NOT EXISTS canonical_beds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  bed_public_id TEXT NOT NULL,
  location_public_id TEXT NOT NULL,
  bed_code TEXT NOT NULL,
  bed_class TEXT NOT NULL,
  operational_status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (tenant_id, bed_public_id),
  UNIQUE (tenant_id, location_public_id, bed_code),
  FOREIGN KEY (tenant_id, location_public_id)
    REFERENCES canonical_care_locations(tenant_id, location_public_id)
    ON DELETE RESTRICT,
  CHECK (length(trim(bed_code)) > 0),
  CHECK (length(trim(bed_class)) > 0),
  CHECK (operational_status IN ('active','inactive','maintenance','retired')),
  CHECK (version > 0),
  CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  )
);

CREATE INDEX IF NOT EXISTS idx_canonical_beds_location_status
  ON canonical_beds(tenant_id, location_public_id, operational_status, bed_code);

CREATE INDEX IF NOT EXISTS idx_canonical_beds_status
  ON canonical_beds(tenant_id, operational_status, bed_public_id);

ALTER TABLE canonical_encounters RENAME TO canonical_encounters_0548_old;

CREATE TABLE canonical_encounters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  legacy_patient_id INTEGER NOT NULL,
  patient_link_public_id TEXT,
  encounter_type TEXT NOT NULL,
  status TEXT NOT NULL,
  encounter_version INTEGER NOT NULL DEFAULT 1,
  care_location_public_id TEXT,
  source_kind TEXT NOT NULL DEFAULT 'migration',
  source_command_key TEXT,
  started_at_utc TEXT NOT NULL,
  ended_at_utc TEXT,
  signed_snapshot_sha256 TEXT,
  signed_at_utc TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (tenant_id, encounter_public_id),
  FOREIGN KEY (tenant_id, patient_link_public_id)
    REFERENCES canonical_tenant_patient_links(tenant_id, patient_link_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, care_location_public_id)
    REFERENCES canonical_care_locations(tenant_id, location_public_id)
    ON DELETE RESTRICT,
  CHECK (encounter_type IN ('outpatient','inpatient','teleconsultation','emergency','other')),
  CHECK (status IN ('planned','in_progress','on_hold','completed','cancelled','entered_in_error','unknown')),
  CHECK (encounter_version > 0),
  CHECK (source_kind IN ('runtime','backfill','import','sync','manual','migration','other')),
  CHECK (ended_at_utc IS NULL OR ended_at_utc >= started_at_utc),
  CHECK (signed_snapshot_sha256 IS NULL OR length(signed_snapshot_sha256) = 64),
  CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  )
);

INSERT INTO canonical_encounters (
  id,tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
  encounter_type,status,encounter_version,care_location_public_id,source_kind,
  source_command_key,started_at_utc,ended_at_utc,signed_snapshot_sha256,signed_at_utc,
  source_evidence_sha256,created_at_utc,updated_at_utc
)
SELECT
  id,tenant_id,encounter_public_id,legacy_patient_id,NULL,
  encounter_type,status,1,NULL,'migration',
  NULL,started_at_utc,ended_at_utc,signed_snapshot_sha256,signed_at_utc,
  source_evidence_sha256,created_at_utc,updated_at_utc
FROM canonical_encounters_0548_old;

DROP TABLE canonical_encounters_0548_old;

CREATE INDEX IF NOT EXISTS idx_canonical_encounters_patient_time
  ON canonical_encounters(tenant_id, legacy_patient_id, started_at_utc, encounter_public_id);

CREATE INDEX IF NOT EXISTS idx_canonical_encounters_type_status
  ON canonical_encounters(tenant_id, encounter_type, status, started_at_utc);

CREATE INDEX IF NOT EXISTS idx_canonical_encounters_signed
  ON canonical_encounters(tenant_id, signed_at_utc, encounter_public_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_encounters_source_command
  ON canonical_encounters(tenant_id, source_command_key)
  WHERE source_command_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_encounters_patient_link_time
  ON canonical_encounters(tenant_id, patient_link_public_id, started_at_utc, encounter_public_id);

CREATE INDEX IF NOT EXISTS idx_canonical_encounters_location_time
  ON canonical_encounters(tenant_id, care_location_public_id, started_at_utc, encounter_public_id);

CREATE INDEX IF NOT EXISTS idx_canonical_encounters_status_version
  ON canonical_encounters(tenant_id, status, encounter_version, started_at_utc);

CREATE TRIGGER IF NOT EXISTS canonical_encounters_validate_insert
BEFORE INSERT ON canonical_encounters
BEGIN
  SELECT CASE
    WHEN NEW.patient_link_public_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM canonical_tenant_patient_links p
      WHERE p.tenant_id = NEW.tenant_id
        AND p.patient_link_public_id = NEW.patient_link_public_id
        AND p.link_status NOT IN ('rejected','retired')
        AND p.effective_to_utc IS NULL
    ) THEN RAISE(ABORT, 'canonical encounter patient link tenant mismatch')
  END;
  SELECT CASE
    WHEN NEW.care_location_public_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM canonical_care_locations l
      WHERE l.tenant_id = NEW.tenant_id
        AND l.location_public_id = NEW.care_location_public_id
        AND l.operational_status = 'active'
    ) THEN RAISE(ABORT, 'canonical encounter care location tenant mismatch')
  END;
  SELECT CASE
    WHEN length(NEW.source_evidence_sha256) <> 64
      OR NEW.source_evidence_sha256 <> lower(NEW.source_evidence_sha256)
      OR NEW.source_evidence_sha256 GLOB '*[^0-9a-f]*'
    THEN RAISE(ABORT, 'canonical encounter source evidence hash invalid')
  END;
END;

CREATE TRIGGER IF NOT EXISTS canonical_encounters_validate_update
BEFORE UPDATE OF patient_link_public_id, care_location_public_id, encounter_version,
  source_kind, source_evidence_sha256 ON canonical_encounters
BEGIN
  SELECT CASE
    WHEN NEW.encounter_version <= 0
    THEN RAISE(ABORT, 'canonical encounter version invalid')
  END;
  SELECT CASE
    WHEN NEW.patient_link_public_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM canonical_tenant_patient_links p
      WHERE p.tenant_id = NEW.tenant_id
        AND p.patient_link_public_id = NEW.patient_link_public_id
        AND p.link_status NOT IN ('rejected','retired')
        AND p.effective_to_utc IS NULL
    ) THEN RAISE(ABORT, 'canonical encounter patient link tenant mismatch')
  END;
  SELECT CASE
    WHEN NEW.care_location_public_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM canonical_care_locations l
      WHERE l.tenant_id = NEW.tenant_id
        AND l.location_public_id = NEW.care_location_public_id
        AND l.operational_status = 'active'
    ) THEN RAISE(ABORT, 'canonical encounter care location tenant mismatch')
  END;
  SELECT CASE
    WHEN length(NEW.source_evidence_sha256) <> 64
      OR NEW.source_evidence_sha256 <> lower(NEW.source_evidence_sha256)
      OR NEW.source_evidence_sha256 GLOB '*[^0-9a-f]*'
    THEN RAISE(ABORT, 'canonical encounter source evidence hash invalid')
  END;
END;

CREATE TABLE IF NOT EXISTS canonical_admissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  admission_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  admission_number TEXT NOT NULL,
  admission_type TEXT NOT NULL,
  admission_source TEXT NOT NULL,
  current_status TEXT NOT NULL,
  status_version INTEGER NOT NULL DEFAULT 1,
  admitted_at_utc TEXT NOT NULL,
  discharged_at_utc TEXT,
  reason_code TEXT,
  safe_note TEXT,
  idempotency_key TEXT NOT NULL,
  request_fingerprint_sha256 TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (tenant_id, admission_public_id),
  UNIQUE (tenant_id, admission_number),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, encounter_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, patient_link_public_id)
    REFERENCES canonical_tenant_patient_links(tenant_id, patient_link_public_id)
    ON DELETE RESTRICT,
  CHECK (length(trim(admission_number)) > 0),
  CHECK (admission_type IN ('inpatient','emergency','transfer','direct','conversion','other')),
  CHECK (admission_source IN ('planned','emergency','transfer','direct','encounter_conversion','import','manual','other')),
  CHECK (current_status IN (
    'planned','admitted','transfer_pending','discharge_pending',
    'discharged','cancelled','entered_in_error'
  )),
  CHECK (status_version > 0),
  CHECK (discharged_at_utc IS NULL OR discharged_at_utc >= admitted_at_utc),
  CHECK (current_status <> 'discharged' OR discharged_at_utc IS NOT NULL),
  CHECK (
    length(request_fingerprint_sha256) = 64
    AND request_fingerprint_sha256 = lower(request_fingerprint_sha256)
    AND request_fingerprint_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_admissions_active_encounter
  ON canonical_admissions(tenant_id, encounter_public_id)
  WHERE current_status IN ('planned','admitted','transfer_pending','discharge_pending');

CREATE INDEX IF NOT EXISTS idx_canonical_admissions_patient_status
  ON canonical_admissions(tenant_id, patient_link_public_id, current_status, admitted_at_utc);

CREATE INDEX IF NOT EXISTS idx_canonical_admissions_status_time
  ON canonical_admissions(tenant_id, current_status, admitted_at_utc, admission_public_id);

CREATE TRIGGER IF NOT EXISTS canonical_admissions_validate_insert
BEFORE INSERT ON canonical_admissions
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM canonical_encounters e
      WHERE e.tenant_id = NEW.tenant_id
        AND e.encounter_public_id = NEW.encounter_public_id
        AND e.patient_link_public_id = NEW.patient_link_public_id
        AND e.encounter_type = 'inpatient'
    ) THEN RAISE(ABORT, 'canonical admission patient encounter mismatch')
  END;
END;

CREATE TRIGGER IF NOT EXISTS canonical_admissions_validate_update
BEFORE UPDATE OF encounter_public_id, patient_link_public_id, current_status,
  status_version, admitted_at_utc, discharged_at_utc ON canonical_admissions
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM canonical_encounters e
      WHERE e.tenant_id = NEW.tenant_id
        AND e.encounter_public_id = NEW.encounter_public_id
        AND e.patient_link_public_id = NEW.patient_link_public_id
        AND e.encounter_type = 'inpatient'
    ) THEN RAISE(ABORT, 'canonical admission patient encounter mismatch')
  END;
END;

CREATE TABLE IF NOT EXISTS canonical_admission_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  event_public_id TEXT NOT NULL,
  admission_public_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  reason_code TEXT,
  safe_note TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  idempotency_key TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  occurred_at_utc TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (tenant_id, event_public_id),
  UNIQUE (tenant_id, admission_public_id, sequence),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, admission_public_id)
    REFERENCES canonical_admissions(tenant_id, admission_public_id)
    ON DELETE RESTRICT,
  CHECK (event_type IN (
    'created','admitted','transfer_requested','transfer_received','transfer_cancelled',
    'discharge_requested','discharge_cancelled','discharged','cancelled','entered_in_error'
  )),
  CHECK (from_status IS NULL OR from_status IN (
    'planned','admitted','transfer_pending','discharge_pending',
    'discharged','cancelled','entered_in_error'
  )),
  CHECK (to_status IN (
    'planned','admitted','transfer_pending','discharge_pending',
    'discharged','cancelled','entered_in_error'
  )),
  CHECK (sequence > 0),
  CHECK (actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL),
  CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  )
);

CREATE INDEX IF NOT EXISTS idx_canonical_admission_events_timeline
  ON canonical_admission_status_events(tenant_id, admission_public_id, sequence, occurred_at_utc);

CREATE INDEX IF NOT EXISTS idx_canonical_admission_events_status
  ON canonical_admission_status_events(tenant_id, to_status, occurred_at_utc, admission_public_id);

CREATE TABLE bed_stays_rebuild_0548 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  bed_stay_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  legacy_patient_bed_info_id INTEGER,
  legacy_admission_id INTEGER,
  legacy_bed_id INTEGER,
  admission_public_id TEXT,
  bed_public_id TEXT,
  patient_link_public_id TEXT,
  started_at_utc TEXT NOT NULL,
  ended_at_utc TEXT,
  status TEXT NOT NULL,
  stay_version INTEGER NOT NULL DEFAULT 1,
  movement_reason TEXT NOT NULL DEFAULT 'migration',
  source_command_key TEXT,
  close_reason TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (tenant_id, bed_stay_public_id),
  FOREIGN KEY (tenant_id, encounter_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, admission_public_id)
    REFERENCES canonical_admissions(tenant_id, admission_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, bed_public_id)
    REFERENCES canonical_beds(tenant_id, bed_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, patient_link_public_id)
    REFERENCES canonical_tenant_patient_links(tenant_id, patient_link_public_id)
    ON DELETE RESTRICT,
  CHECK (status IN ('active','completed','invalid')),
  CHECK (ended_at_utc IS NULL OR ended_at_utc >= started_at_utc),
  CHECK (stay_version > 0),
  CHECK (movement_reason IN ('admission','transfer','readmission','correction','migration','other')),
  CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 = lower(source_evidence_sha256)
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  )
);

INSERT INTO bed_stays_rebuild_0548 (
  id,tenant_id,bed_stay_public_id,encounter_public_id,
  legacy_patient_bed_info_id,legacy_admission_id,legacy_bed_id,
  admission_public_id,bed_public_id,patient_link_public_id,
  started_at_utc,ended_at_utc,status,stay_version,movement_reason,
  source_command_key,close_reason,source_evidence_sha256,created_at_utc,updated_at_utc
)
SELECT
  id,tenant_id,bed_stay_public_id,encounter_public_id,
  legacy_patient_bed_info_id,legacy_admission_id,legacy_bed_id,
  NULL,NULL,NULL,
  started_at_utc,ended_at_utc,status,1,'migration',
  NULL,NULL,source_evidence_sha256,created_at_utc,updated_at_utc
FROM canonical_bed_stays;

DROP TABLE canonical_bed_stays;
ALTER TABLE bed_stays_rebuild_0548 RENAME TO canonical_bed_stays;

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_bed_stays_public_id
  ON canonical_bed_stays(tenant_id, bed_stay_public_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_bed_stays_legacy
  ON canonical_bed_stays(tenant_id, legacy_patient_bed_info_id)
  WHERE legacy_patient_bed_info_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_bed_stays_source_command
  ON canonical_bed_stays(tenant_id, source_command_key)
  WHERE source_command_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_bed_stays_open_bed
  ON canonical_bed_stays(tenant_id, bed_public_id)
  WHERE status = 'active' AND bed_public_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_bed_stays_open_admission
  ON canonical_bed_stays(tenant_id, admission_public_id)
  WHERE status = 'active' AND admission_public_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_bed_stays_encounter_time
  ON canonical_bed_stays(tenant_id, encounter_public_id, started_at_utc, bed_stay_public_id);

CREATE INDEX IF NOT EXISTS idx_canonical_bed_stays_bed_time
  ON canonical_bed_stays(tenant_id, bed_public_id, started_at_utc, ended_at_utc);

CREATE INDEX IF NOT EXISTS idx_canonical_bed_stays_admission_time
  ON canonical_bed_stays(tenant_id, admission_public_id, started_at_utc, ended_at_utc);

CREATE TRIGGER IF NOT EXISTS canonical_bed_stays_lifecycle_insert
BEFORE INSERT ON canonical_bed_stays
BEGIN
  SELECT CASE
    WHEN NEW.status = 'active' AND NEW.ended_at_utc IS NOT NULL
    THEN RAISE(ABORT, 'canonical active bed stay cannot have an end time')
  END;
  SELECT CASE
    WHEN NEW.status IN ('completed','invalid') AND NEW.ended_at_utc IS NULL
    THEN RAISE(ABORT, 'canonical closed bed stay requires an end time')
  END;
  SELECT CASE
    WHEN NEW.status = 'invalid' AND (NEW.close_reason IS NULL OR trim(NEW.close_reason) = '')
    THEN RAISE(ABORT, 'canonical invalid bed stay requires a close reason')
  END;
  SELECT CASE
    WHEN length(NEW.source_evidence_sha256) <> 64
      OR NEW.source_evidence_sha256 <> lower(NEW.source_evidence_sha256)
      OR NEW.source_evidence_sha256 GLOB '*[^0-9a-f]*'
    THEN RAISE(ABORT, 'canonical bed stay source evidence hash invalid')
  END;
END;

CREATE TRIGGER IF NOT EXISTS canonical_bed_stays_lifecycle_update
BEFORE UPDATE OF status, ended_at_utc, close_reason, source_evidence_sha256
ON canonical_bed_stays
BEGIN
  SELECT CASE
    WHEN NEW.status = 'active' AND NEW.ended_at_utc IS NOT NULL
    THEN RAISE(ABORT, 'canonical active bed stay cannot have an end time')
  END;
  SELECT CASE
    WHEN NEW.status IN ('completed','invalid') AND NEW.ended_at_utc IS NULL
    THEN RAISE(ABORT, 'canonical closed bed stay requires an end time')
  END;
  SELECT CASE
    WHEN NEW.status = 'invalid' AND (NEW.close_reason IS NULL OR trim(NEW.close_reason) = '')
    THEN RAISE(ABORT, 'canonical invalid bed stay requires a close reason')
  END;
  SELECT CASE
    WHEN length(NEW.source_evidence_sha256) <> 64
      OR NEW.source_evidence_sha256 <> lower(NEW.source_evidence_sha256)
      OR NEW.source_evidence_sha256 GLOB '*[^0-9a-f]*'
    THEN RAISE(ABORT, 'canonical bed stay source evidence hash invalid')
  END;
END;

CREATE TRIGGER IF NOT EXISTS canonical_bed_stays_validate_insert
BEFORE INSERT ON canonical_bed_stays
WHEN NEW.admission_public_id IS NOT NULL
  OR NEW.bed_public_id IS NOT NULL
  OR NEW.patient_link_public_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW.admission_public_id IS NULL
      OR NEW.bed_public_id IS NULL
      OR NEW.patient_link_public_id IS NULL
    THEN RAISE(ABORT, 'canonical bed stay public references incomplete')
  END;
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM canonical_admissions a
      JOIN canonical_encounters e
        ON e.tenant_id = a.tenant_id
       AND e.encounter_public_id = a.encounter_public_id
      WHERE a.tenant_id = NEW.tenant_id
        AND a.admission_public_id = NEW.admission_public_id
        AND a.encounter_public_id = NEW.encounter_public_id
        AND a.patient_link_public_id = NEW.patient_link_public_id
        AND e.patient_link_public_id = NEW.patient_link_public_id
    ) THEN RAISE(ABORT, 'canonical bed stay patient admission encounter mismatch')
  END;
  SELECT CASE
    WHEN NEW.status = 'active' AND NOT EXISTS (
      SELECT 1
      FROM canonical_beds b
      WHERE b.tenant_id = NEW.tenant_id
        AND b.bed_public_id = NEW.bed_public_id
        AND b.operational_status = 'active'
    ) THEN RAISE(ABORT, 'canonical bed stay bed must be active')
  END;
END;

CREATE TRIGGER IF NOT EXISTS canonical_bed_stays_validate_update
BEFORE UPDATE OF encounter_public_id, admission_public_id, bed_public_id,
  patient_link_public_id, status, stay_version, started_at_utc, ended_at_utc
ON canonical_bed_stays
WHEN NEW.admission_public_id IS NOT NULL
  OR NEW.bed_public_id IS NOT NULL
  OR NEW.patient_link_public_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW.admission_public_id IS NULL
      OR NEW.bed_public_id IS NULL
      OR NEW.patient_link_public_id IS NULL
    THEN RAISE(ABORT, 'canonical bed stay public references incomplete')
  END;
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM canonical_admissions a
      JOIN canonical_encounters e
        ON e.tenant_id = a.tenant_id
       AND e.encounter_public_id = a.encounter_public_id
      WHERE a.tenant_id = NEW.tenant_id
        AND a.admission_public_id = NEW.admission_public_id
        AND a.encounter_public_id = NEW.encounter_public_id
        AND a.patient_link_public_id = NEW.patient_link_public_id
        AND e.patient_link_public_id = NEW.patient_link_public_id
    ) THEN RAISE(ABORT, 'canonical bed stay patient admission encounter mismatch')
  END;
  SELECT CASE
    WHEN NEW.status = 'active' AND NOT EXISTS (
      SELECT 1
      FROM canonical_beds b
      WHERE b.tenant_id = NEW.tenant_id
        AND b.bed_public_id = NEW.bed_public_id
        AND b.operational_status = 'active'
    ) THEN RAISE(ABORT, 'canonical bed stay bed must be active')
  END;
END;

PRAGMA legacy_alter_table = OFF;
PRAGMA foreign_keys = ON;
