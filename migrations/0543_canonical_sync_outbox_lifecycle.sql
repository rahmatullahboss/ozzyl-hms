-- CDB-110F: additive source canonical-outbox claim/publication lifecycle hardening.
-- This migration does not connect transport, register workers, or activate synchronization.

ALTER TABLE canonical_outbox_events
  ADD COLUMN claim_public_id TEXT CHECK (
    claim_public_id IS NULL
    OR (
      length(trim(claim_public_id)) BETWEEN 1 AND 160
      AND claim_public_id GLOB '*[^0-9]*'
    )
  );

ALTER TABLE canonical_outbox_events
  ADD COLUMN claim_expires_at_utc TEXT CHECK (
    claim_expires_at_utc IS NULL OR substr(claim_expires_at_utc, -1) = 'Z'
  );

ALTER TABLE canonical_outbox_events
  ADD COLUMN last_error_sha256 TEXT CHECK (
    last_error_sha256 IS NULL
    OR (
      length(last_error_sha256) = 64
      AND last_error_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  );

ALTER TABLE canonical_outbox_events
  ADD COLUMN published_envelope_sha256 TEXT CHECK (
    published_envelope_sha256 IS NULL
    OR (
      length(published_envelope_sha256) = 64
      AND published_envelope_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  );

CREATE INDEX IF NOT EXISTS idx_canonical_outbox_sync_claimable
  ON canonical_outbox_events (
    tenant_id,
    status,
    available_at_utc,
    claim_expires_at_utc,
    aggregate_type,
    aggregate_public_id,
    id
  );

CREATE TRIGGER IF NOT EXISTS trg_canonical_outbox_sync_lifecycle_insert
BEFORE INSERT ON canonical_outbox_events
WHEN
  (
    NEW.status = 'processing'
    AND (
      NEW.claim_public_id IS NULL
      OR NEW.locked_at_utc IS NULL
      OR NEW.locked_by IS NULL
      OR NEW.claim_expires_at_utc IS NULL
      OR substr(NEW.locked_at_utc, -1) <> 'Z'
      OR NEW.claim_expires_at_utc <= NEW.locked_at_utc
      OR length(trim(NEW.locked_by)) NOT BETWEEN 1 AND 192
      OR NEW.locked_by NOT GLOB '*[^0-9]*'
    )
  )
  OR (
    NEW.status <> 'processing'
    AND (
      NEW.claim_public_id IS NOT NULL
      OR NEW.locked_at_utc IS NOT NULL
      OR NEW.locked_by IS NOT NULL
      OR NEW.claim_expires_at_utc IS NOT NULL
    )
  )
  OR (
    NEW.status = 'published'
    AND (
      NEW.published_at_utc IS NULL
      OR substr(NEW.published_at_utc, -1) <> 'Z'
      OR NEW.published_envelope_sha256 IS NULL
    )
  )
  OR (
    NEW.status <> 'published'
    AND (
      NEW.published_at_utc IS NOT NULL
      OR NEW.published_envelope_sha256 IS NOT NULL
    )
  )
  OR (
    NEW.status IN ('retry', 'dead_letter')
    AND (
      NEW.last_error_code IS NULL
      OR length(NEW.last_error_code) NOT BETWEEN 1 AND 96
      OR substr(NEW.last_error_code, 1, 1) NOT GLOB '[A-Z]'
      OR NEW.last_error_code GLOB '*[^A-Z0-9_]*'
      OR NEW.last_error_sha256 IS NULL
      OR (
        NEW.last_error_summary IS NOT NULL
        AND (
          trim(NEW.last_error_summary) <> NEW.last_error_summary
          OR length(NEW.last_error_summary) NOT BETWEEN 1 AND 512
        )
      )
      OR (NEW.status = 'retry' AND NEW.available_at_utc < NEW.updated_at_utc)
    )
  )
  OR (
    NEW.status IN ('pending', 'processing', 'published', 'cancelled')
    AND (
      NEW.last_error_code IS NOT NULL
      OR NEW.last_error_summary IS NOT NULL
      OR NEW.last_error_sha256 IS NOT NULL
    )
  )
BEGIN
  SELECT CASE
    WHEN NEW.status = 'processing'
      OR NEW.claim_public_id IS NOT NULL
      OR NEW.locked_at_utc IS NOT NULL
      OR NEW.locked_by IS NOT NULL
      OR NEW.claim_expires_at_utc IS NOT NULL
      THEN RAISE(ABORT, 'canonical outbox claim evidence is inconsistent')
    WHEN NEW.status = 'published'
      OR NEW.published_at_utc IS NOT NULL
      OR NEW.published_envelope_sha256 IS NOT NULL
      THEN RAISE(ABORT, 'canonical outbox publication evidence is inconsistent')
    ELSE RAISE(ABORT, 'canonical outbox error evidence is inconsistent')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_outbox_sync_lifecycle_update
BEFORE UPDATE ON canonical_outbox_events
WHEN
  (
    NEW.status = 'processing'
    AND (
      NEW.claim_public_id IS NULL
      OR NEW.locked_at_utc IS NULL
      OR NEW.locked_by IS NULL
      OR NEW.claim_expires_at_utc IS NULL
      OR substr(NEW.locked_at_utc, -1) <> 'Z'
      OR NEW.claim_expires_at_utc <= NEW.locked_at_utc
      OR length(trim(NEW.locked_by)) NOT BETWEEN 1 AND 192
      OR NEW.locked_by NOT GLOB '*[^0-9]*'
    )
  )
  OR (
    NEW.status <> 'processing'
    AND (
      NEW.claim_public_id IS NOT NULL
      OR NEW.locked_at_utc IS NOT NULL
      OR NEW.locked_by IS NOT NULL
      OR NEW.claim_expires_at_utc IS NOT NULL
    )
  )
  OR (
    NEW.status = 'published'
    AND (
      NEW.published_at_utc IS NULL
      OR substr(NEW.published_at_utc, -1) <> 'Z'
      OR NEW.published_envelope_sha256 IS NULL
    )
  )
  OR (
    NEW.status <> 'published'
    AND (
      NEW.published_at_utc IS NOT NULL
      OR NEW.published_envelope_sha256 IS NOT NULL
    )
  )
  OR (
    NEW.status IN ('retry', 'dead_letter')
    AND (
      NEW.last_error_code IS NULL
      OR length(NEW.last_error_code) NOT BETWEEN 1 AND 96
      OR substr(NEW.last_error_code, 1, 1) NOT GLOB '[A-Z]'
      OR NEW.last_error_code GLOB '*[^A-Z0-9_]*'
      OR NEW.last_error_sha256 IS NULL
      OR (
        NEW.last_error_summary IS NOT NULL
        AND (
          trim(NEW.last_error_summary) <> NEW.last_error_summary
          OR length(NEW.last_error_summary) NOT BETWEEN 1 AND 512
        )
      )
      OR (NEW.status = 'retry' AND NEW.available_at_utc < NEW.updated_at_utc)
    )
  )
  OR (
    NEW.status IN ('pending', 'processing', 'published', 'cancelled')
    AND (
      NEW.last_error_code IS NOT NULL
      OR NEW.last_error_summary IS NOT NULL
      OR NEW.last_error_sha256 IS NOT NULL
    )
  )
BEGIN
  SELECT CASE
    WHEN NEW.status = 'processing'
      OR NEW.claim_public_id IS NOT NULL
      OR NEW.locked_at_utc IS NOT NULL
      OR NEW.locked_by IS NOT NULL
      OR NEW.claim_expires_at_utc IS NOT NULL
      THEN RAISE(ABORT, 'canonical outbox claim evidence is inconsistent')
    WHEN NEW.status = 'published'
      OR NEW.published_at_utc IS NOT NULL
      OR NEW.published_envelope_sha256 IS NOT NULL
      THEN RAISE(ABORT, 'canonical outbox publication evidence is inconsistent')
    ELSE RAISE(ABORT, 'canonical outbox error evidence is inconsistent')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_outbox_sync_semantic_immutable
BEFORE UPDATE ON canonical_outbox_events
WHEN
  NEW.tenant_id IS NOT OLD.tenant_id
  OR NEW.event_public_id IS NOT OLD.event_public_id
  OR NEW.aggregate_type IS NOT OLD.aggregate_type
  OR NEW.aggregate_public_id IS NOT OLD.aggregate_public_id
  OR NEW.event_type IS NOT OLD.event_type
  OR NEW.event_version IS NOT OLD.event_version
  OR NEW.payload_json IS NOT OLD.payload_json
  OR NEW.occurred_at_utc IS NOT OLD.occurred_at_utc
  OR NEW.business_date IS NOT OLD.business_date
  OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.created_at_utc IS NOT OLD.created_at_utc
BEGIN
  SELECT RAISE(ABORT, 'canonical outbox semantic authority is immutable');
END;
