-- CDB-113B: canonical tenant-patient to global-identity relationship authority.
-- This migration is additive. It does not copy demographics or retire patients/global_patient_identity.

CREATE TABLE IF NOT EXISTS canonical_tenant_patient_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  legacy_patient_id INTEGER NOT NULL,
  global_patient_uhid TEXT,
  link_status TEXT NOT NULL,
  verification_level TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL,
  effective_from_utc TEXT NOT NULL,
  effective_to_utc TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT uq_canonical_tenant_patient_links_public_id
    UNIQUE (tenant_id, patient_link_public_id),
  CONSTRAINT uq_canonical_tenant_patient_links_legacy_patient
    UNIQUE (tenant_id, legacy_patient_id),
  CONSTRAINT canonical_tenant_patient_links_legacy_patient_check
    CHECK (legacy_patient_id > 0),
  CONSTRAINT canonical_tenant_patient_links_status_check
    CHECK (link_status IN ('unlinked', 'candidate', 'verified', 'rejected', 'merged', 'retired')),
  CONSTRAINT canonical_tenant_patient_links_verification_check
    CHECK (verification_level IN ('unverified', 'candidate', 'reviewed', 'verified')),
  CONSTRAINT canonical_tenant_patient_links_evidence_type_check
    CHECK (evidence_type IN (
      'no_link_placeholder',
      'ambiguous_candidate',
      'unique_uhid',
      'authenticated_claim',
      'verified_national_identity',
      'reviewed_manual',
      'migration_evidence'
    )),
  CONSTRAINT canonical_tenant_patient_links_evidence_hash_check
    CHECK (length(evidence_sha256) = 64),
  CONSTRAINT canonical_tenant_patient_links_version_check
    CHECK (version > 0),
  CONSTRAINT canonical_tenant_patient_links_effective_from_check
    CHECK (substr(effective_from_utc, -1) = 'Z'),
  CONSTRAINT canonical_tenant_patient_links_effective_to_check
    CHECK (effective_to_utc IS NULL OR (
      substr(effective_to_utc, -1) = 'Z' AND effective_to_utc >= effective_from_utc
    )),
  CONSTRAINT canonical_tenant_patient_links_global_identity_shape_check
    CHECK (global_patient_uhid IS NULL OR trim(global_patient_uhid) = global_patient_uhid),
  CONSTRAINT canonical_tenant_patient_links_verified_evidence_check
    CHECK (
      link_status != 'verified' OR (
        global_patient_uhid IS NOT NULL
        AND trim(global_patient_uhid) != ''
        AND verification_level = 'verified'
        AND evidence_type IN ('unique_uhid', 'authenticated_claim', 'verified_national_identity', 'reviewed_manual')
      )
    ),
  CONSTRAINT canonical_tenant_patient_links_nonverified_global_check
    CHECK (link_status IN ('verified', 'merged') OR global_patient_uhid IS NULL),
  CONSTRAINT canonical_tenant_patient_links_candidate_check
    CHECK (link_status != 'candidate' OR (
      verification_level = 'candidate' AND evidence_type = 'ambiguous_candidate'
    )),
  CONSTRAINT canonical_tenant_patient_links_unlinked_check
    CHECK (link_status != 'unlinked' OR (
      verification_level = 'unverified' AND evidence_type = 'no_link_placeholder'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_tenant_patient_links_verified_global
  ON canonical_tenant_patient_links (tenant_id, global_patient_uhid)
  WHERE global_patient_uhid IS NOT NULL AND link_status = 'verified';

CREATE INDEX IF NOT EXISTS idx_canonical_tenant_patient_links_global
  ON canonical_tenant_patient_links (global_patient_uhid, link_status, tenant_id);

CREATE INDEX IF NOT EXISTS idx_canonical_tenant_patient_links_status
  ON canonical_tenant_patient_links (tenant_id, link_status, updated_at_utc, id);

CREATE TABLE IF NOT EXISTS canonical_tenant_patient_link_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  event_public_id TEXT NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  legacy_patient_id INTEGER NOT NULL,
  global_patient_uhid TEXT,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  source_legacy_patient_id INTEGER,
  target_legacy_patient_id INTEGER,
  actor_user_id INTEGER,
  actor_system_key TEXT,
  reason_code TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  occurred_at_utc TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT uq_canonical_tenant_patient_link_events_public_id
    UNIQUE (tenant_id, event_public_id),
  CONSTRAINT uq_canonical_tenant_patient_link_events_sequence
    UNIQUE (tenant_id, patient_link_public_id, sequence),
  CONSTRAINT uq_canonical_tenant_patient_link_events_idempotency
    UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT fk_canonical_tenant_patient_link_events_link
    FOREIGN KEY (tenant_id, patient_link_public_id)
    REFERENCES canonical_tenant_patient_links (tenant_id, patient_link_public_id)
    ON DELETE RESTRICT,
  CONSTRAINT canonical_tenant_patient_link_events_legacy_patient_check
    CHECK (legacy_patient_id > 0),
  CONSTRAINT canonical_tenant_patient_link_events_type_check
    CHECK (event_type IN (
      'registered',
      'candidate_detected',
      'verified_linked',
      'link_rejected',
      'unlinked',
      'merged',
      'unmerged',
      'retired'
    )),
  CONSTRAINT canonical_tenant_patient_link_events_from_status_check
    CHECK (from_status IS NULL OR from_status IN ('unlinked', 'candidate', 'verified', 'rejected', 'merged', 'retired')),
  CONSTRAINT canonical_tenant_patient_link_events_to_status_check
    CHECK (to_status IN ('unlinked', 'candidate', 'verified', 'rejected', 'merged', 'retired')),
  CONSTRAINT canonical_tenant_patient_link_events_evidence_type_check
    CHECK (evidence_type IN (
      'no_link_placeholder',
      'ambiguous_candidate',
      'unique_uhid',
      'authenticated_claim',
      'verified_national_identity',
      'reviewed_manual',
      'migration_evidence'
    )),
  CONSTRAINT canonical_tenant_patient_link_events_evidence_hash_check
    CHECK (length(evidence_sha256) = 64),
  CONSTRAINT canonical_tenant_patient_link_events_sequence_check
    CHECK (sequence > 0),
  CONSTRAINT canonical_tenant_patient_link_events_occurred_check
    CHECK (substr(occurred_at_utc, -1) = 'Z'),
  CONSTRAINT canonical_tenant_patient_link_events_actor_check
    CHECK (actor_user_id IS NOT NULL OR (actor_system_key IS NOT NULL AND trim(actor_system_key) != '')),
  CONSTRAINT canonical_tenant_patient_link_events_reason_check
    CHECK (trim(reason_code) != ''),
  CONSTRAINT canonical_tenant_patient_link_events_merge_check
    CHECK (
      event_type NOT IN ('merged', 'unmerged') OR (
        source_legacy_patient_id IS NOT NULL
        AND target_legacy_patient_id IS NOT NULL
        AND source_legacy_patient_id > 0
        AND target_legacy_patient_id > 0
        AND source_legacy_patient_id != target_legacy_patient_id
      )
    ),
  CONSTRAINT canonical_tenant_patient_link_events_verified_check
    CHECK (
      to_status != 'verified' OR (
        global_patient_uhid IS NOT NULL
        AND trim(global_patient_uhid) != ''
        AND evidence_type IN ('unique_uhid', 'authenticated_claim', 'verified_national_identity', 'reviewed_manual')
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_canonical_tenant_patient_link_events_link
  ON canonical_tenant_patient_link_events (tenant_id, patient_link_public_id, sequence, id);

CREATE INDEX IF NOT EXISTS idx_canonical_tenant_patient_link_events_global
  ON canonical_tenant_patient_link_events (global_patient_uhid, occurred_at_utc, id);

CREATE INDEX IF NOT EXISTS idx_canonical_tenant_patient_link_events_source
  ON canonical_tenant_patient_link_events (tenant_id, legacy_patient_id, occurred_at_utc, id);
