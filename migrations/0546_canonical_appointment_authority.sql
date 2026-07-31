-- =============================================================================
-- HMS Canonical Appointment Authority (D1 / SQLite)
-- Additive-only planned-intent, immutable status history, and explicit
-- appointment-to-encounter linkage. Legacy appointment, consultation, schedule,
-- marketplace, visit, queue, and billing rows remain unchanged until cutover.
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  appointment_public_id TEXT NOT NULL,
  patient_link_public_id TEXT NOT NULL,
  requested_practitioner_public_id TEXT,
  requested_service_item_public_id TEXT,
  requested_location_public_id TEXT,
  appointment_kind TEXT NOT NULL,
  modality TEXT NOT NULL,
  scheduling_channel TEXT NOT NULL,
  requested_start_utc TEXT NOT NULL,
  requested_end_utc TEXT NOT NULL,
  business_date TEXT NOT NULL,
  timezone TEXT NOT NULL,
  token_number INTEGER,
  token_assignment_type TEXT NOT NULL DEFAULT 'none',
  current_status TEXT NOT NULL,
  status_version INTEGER NOT NULL DEFAULT 1,
  rescheduled_from_appointment_public_id TEXT,
  request_note TEXT,
  referral_practitioner_public_id TEXT,
  quoted_amount_minor INTEGER,
  currency_code TEXT,
  quote_source TEXT,
  quote_effective_at_utc TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_appointments_kind_check CHECK (
    appointment_kind IN (
      'new_patient','follow_up','report_review','free_visit',
      'emergency_request','telemedicine','other'
    )
  ),
  CONSTRAINT canonical_appointments_modality_check CHECK (
    modality IN ('in_person','telemedicine','home_visit','other')
  ),
  CONSTRAINT canonical_appointments_channel_check CHECK (
    scheduling_channel IN (
      'reception','patient_portal','marketplace','doctor_follow_up','import','other'
    )
  ),
  CONSTRAINT canonical_appointments_status_check CHECK (
    current_status IN (
      'requested','scheduled','confirmed','arrived','checked_in',
      'fulfilled','cancelled','no_show','rescheduled','entered_in_error'
    )
  ),
  CONSTRAINT canonical_appointments_status_version_check CHECK (status_version > 0),
  CONSTRAINT canonical_appointments_interval_check CHECK (
    substr(requested_start_utc, -1) = 'Z'
    AND substr(requested_end_utc, -1) = 'Z'
    AND requested_end_utc >= requested_start_utc
  ),
  CONSTRAINT canonical_appointments_business_date_check CHECK (
    business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  CONSTRAINT canonical_appointments_timezone_check CHECK (length(trim(timezone)) > 0),
  CONSTRAINT canonical_appointments_token_check CHECK (
    (token_assignment_type = 'none' AND token_number IS NULL)
    OR (
      token_assignment_type IN ('auto','reserved','manual')
      AND token_number IS NOT NULL
      AND token_number > 0
    )
  ),
  CONSTRAINT canonical_appointments_reschedule_self_check CHECK (
    rescheduled_from_appointment_public_id IS NULL
    OR rescheduled_from_appointment_public_id != appointment_public_id
  ),
  CONSTRAINT canonical_appointments_quote_check CHECK (
    (
      quoted_amount_minor IS NULL
      AND currency_code IS NULL
      AND quote_source IS NULL
      AND quote_effective_at_utc IS NULL
    )
    OR (
      quoted_amount_minor IS NOT NULL
      AND quoted_amount_minor >= 0
      AND currency_code IS NOT NULL
      AND length(currency_code) = 3
      AND currency_code = upper(currency_code)
      AND quote_source IS NOT NULL
      AND length(trim(quote_source)) > 0
      AND quote_effective_at_utc IS NOT NULL
      AND substr(quote_effective_at_utc, -1) = 'Z'
    )
  ),
  CONSTRAINT canonical_appointments_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  FOREIGN KEY (tenant_id, patient_link_public_id)
    REFERENCES canonical_tenant_patient_links(tenant_id, patient_link_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, requested_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, referral_practitioner_public_id)
    REFERENCES canonical_practitioners(tenant_id, practitioner_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, requested_service_item_public_id)
    REFERENCES canonical_service_catalog_items(tenant_id, service_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, rescheduled_from_appointment_public_id)
    REFERENCES canonical_appointments(tenant_id, appointment_public_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, appointment_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_appointments_patient_time
  ON canonical_appointments(
    tenant_id, patient_link_public_id, requested_start_utc, appointment_public_id
  );

CREATE INDEX IF NOT EXISTS idx_canonical_appointments_practitioner_time
  ON canonical_appointments(
    tenant_id, requested_practitioner_public_id, requested_start_utc, appointment_public_id
  );

CREATE INDEX IF NOT EXISTS idx_canonical_appointments_date_status
  ON canonical_appointments(
    tenant_id, business_date, current_status, requested_start_utc, appointment_public_id
  );

CREATE INDEX IF NOT EXISTS idx_canonical_appointments_reschedule_lineage
  ON canonical_appointments(
    tenant_id, rescheduled_from_appointment_public_id, appointment_public_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_appointments_active_token
  ON canonical_appointments(
    tenant_id, requested_practitioner_public_id, business_date, token_number
  )
  WHERE token_number IS NOT NULL
    AND token_assignment_type != 'manual'
    AND current_status NOT IN ('cancelled','no_show','rescheduled','entered_in_error');

CREATE TABLE IF NOT EXISTS canonical_appointment_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  event_public_id TEXT NOT NULL,
  appointment_public_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  reason_code TEXT NOT NULL,
  safe_note TEXT,
  actor_user_public_id TEXT,
  actor_system_key TEXT,
  idempotency_key TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  occurred_at_utc TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT canonical_appointment_status_events_type_check CHECK (
    event_type IN (
      'created','scheduled','confirmed','arrived','checked_in','fulfilled',
      'cancelled','no_show','rescheduled','entered_in_error'
    )
  ),
  CONSTRAINT canonical_appointment_status_events_from_check CHECK (
    from_status IS NULL OR from_status IN (
      'requested','scheduled','confirmed','arrived','checked_in',
      'fulfilled','cancelled','no_show','rescheduled','entered_in_error'
    )
  ),
  CONSTRAINT canonical_appointment_status_events_to_check CHECK (
    to_status IN (
      'requested','scheduled','confirmed','arrived','checked_in',
      'fulfilled','cancelled','no_show','rescheduled','entered_in_error'
    )
  ),
  CONSTRAINT canonical_appointment_status_events_sequence_check CHECK (sequence > 0),
  CONSTRAINT canonical_appointment_status_events_reason_check CHECK (length(trim(reason_code)) > 0),
  CONSTRAINT canonical_appointment_status_events_actor_check CHECK (
    actor_user_public_id IS NOT NULL OR actor_system_key IS NOT NULL
  ),
  CONSTRAINT canonical_appointment_status_events_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT canonical_appointment_status_events_occurred_check CHECK (
    substr(occurred_at_utc, -1) = 'Z'
  ),
  FOREIGN KEY (tenant_id, appointment_public_id)
    REFERENCES canonical_appointments(tenant_id, appointment_public_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, event_public_id),
  UNIQUE (tenant_id, appointment_public_id, sequence),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_canonical_appointment_status_events_timeline
  ON canonical_appointment_status_events(
    tenant_id, appointment_public_id, sequence, occurred_at_utc
  );

CREATE TABLE IF NOT EXISTS canonical_appointment_encounter_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  link_public_id TEXT NOT NULL,
  appointment_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  link_type TEXT NOT NULL,
  link_status TEXT NOT NULL DEFAULT 'active',
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  retired_at_utc TEXT,
  CONSTRAINT canonical_appointment_encounter_links_type_check CHECK (
    link_type IN (
      'fulfilled_by','converted_to_emergency','converted_to_inpatient','approved_manual'
    )
  ),
  CONSTRAINT canonical_appointment_encounter_links_status_check CHECK (
    link_status IN ('active','retired','rejected')
  ),
  CONSTRAINT canonical_appointment_encounter_links_lifecycle_check CHECK (
    (link_status = 'active' AND retired_at_utc IS NULL)
    OR (link_status IN ('retired','rejected') AND retired_at_utc IS NOT NULL)
  ),
  CONSTRAINT canonical_appointment_encounter_links_time_check CHECK (
    substr(created_at_utc, -1) = 'Z'
    AND (retired_at_utc IS NULL OR (substr(retired_at_utc, -1) = 'Z' AND retired_at_utc >= created_at_utc))
  ),
  CONSTRAINT canonical_appointment_encounter_links_evidence_check CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  FOREIGN KEY (tenant_id, appointment_public_id)
    REFERENCES canonical_appointments(tenant_id, appointment_public_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, encounter_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, link_public_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_appointment_encounter_links_active_appointment
  ON canonical_appointment_encounter_links(tenant_id, appointment_public_id)
  WHERE link_status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_appointment_encounter_links_active_encounter
  ON canonical_appointment_encounter_links(tenant_id, encounter_public_id)
  WHERE link_status = 'active';

CREATE INDEX IF NOT EXISTS idx_canonical_appointment_encounter_links_status
  ON canonical_appointment_encounter_links(
    tenant_id, link_status, appointment_public_id, encounter_public_id
  );
