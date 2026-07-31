-- CDB-110C: additive canonical sync inbox lifecycle and atomic assertion support.
-- This migration does not activate synchronization or connect runtime routes.

ALTER TABLE canonical_sync_inbox_events
  ADD COLUMN occurred_at_utc TEXT CHECK (
    occurred_at_utc IS NULL OR substr(occurred_at_utc, -1) = 'Z'
  );

ALTER TABLE canonical_sync_inbox_events
  ADD COLUMN claim_public_id TEXT CHECK (
    claim_public_id IS NULL
    OR (
      length(trim(claim_public_id)) BETWEEN 1 AND 160
      AND claim_public_id GLOB '*[^0-9]*'
    )
  );

ALTER TABLE canonical_sync_inbox_events
  ADD COLUMN claim_owner_public_id TEXT CHECK (
    claim_owner_public_id IS NULL
    OR (
      length(trim(claim_owner_public_id)) BETWEEN 1 AND 192
      AND claim_owner_public_id GLOB '*[^0-9]*'
    )
  );

ALTER TABLE canonical_sync_inbox_events
  ADD COLUMN claim_expires_at_utc TEXT CHECK (
    claim_expires_at_utc IS NULL OR substr(claim_expires_at_utc, -1) = 'Z'
  );

ALTER TABLE canonical_sync_inbox_events
  ADD COLUMN next_attempt_at_utc TEXT CHECK (
    next_attempt_at_utc IS NULL OR substr(next_attempt_at_utc, -1) = 'Z'
  );

CREATE TABLE IF NOT EXISTS canonical_sync_batch_assertions (
  tenant_id TEXT NOT NULL CHECK (length(trim(tenant_id)) BETWEEN 1 AND 128),
  operation_key TEXT NOT NULL CHECK (length(trim(operation_key)) BETWEEN 1 AND 256),
  step_key TEXT NOT NULL CHECK (length(trim(step_key)) BETWEEN 1 AND 128),
  assertion_value INTEGER NOT NULL CHECK (assertion_value = 1),
  created_at_utc TEXT NOT NULL CHECK (
    length(trim(created_at_utc)) >= 20 AND substr(created_at_utc, -1) = 'Z'
  ),
  PRIMARY KEY (tenant_id, operation_key, step_key)
);

CREATE INDEX IF NOT EXISTS idx_canonical_sync_inbox_claimable
  ON canonical_sync_inbox_events (
    tenant_id,
    status,
    next_attempt_at_utc,
    claim_expires_at_utc,
    received_at_utc,
    event_public_id
  );

CREATE TRIGGER IF NOT EXISTS trg_canonical_sync_inbox_lifecycle_insert
BEFORE INSERT ON canonical_sync_inbox_events
WHEN
  (
    NEW.status = 'applying'
    AND (
      NEW.claim_public_id IS NULL
      OR NEW.claim_owner_public_id IS NULL
      OR NEW.claim_expires_at_utc IS NULL
    )
  )
  OR (
    NEW.status <> 'applying'
    AND (
      NEW.claim_public_id IS NOT NULL
      OR NEW.claim_owner_public_id IS NOT NULL
      OR NEW.claim_expires_at_utc IS NOT NULL
    )
  )
  OR (NEW.status = 'retry' AND NEW.next_attempt_at_utc IS NULL)
  OR (NEW.status <> 'retry' AND NEW.next_attempt_at_utc IS NOT NULL)
  OR (
    NEW.status IN ('retry', 'dead_letter')
    AND (NEW.error_code IS NULL OR NEW.error_hash IS NULL)
  )
BEGIN
  SELECT CASE
    WHEN NEW.status = 'applying' OR NEW.claim_public_id IS NOT NULL
      OR NEW.claim_owner_public_id IS NOT NULL OR NEW.claim_expires_at_utc IS NOT NULL
      THEN RAISE(ABORT, 'canonical sync claim evidence is inconsistent')
    WHEN NEW.status = 'retry' OR NEW.next_attempt_at_utc IS NOT NULL
      THEN RAISE(ABORT, 'canonical sync retry evidence is inconsistent')
    ELSE RAISE(ABORT, 'canonical sync terminal error evidence is incomplete')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_sync_inbox_lifecycle_update
BEFORE UPDATE ON canonical_sync_inbox_events
WHEN
  (
    NEW.status = 'applying'
    AND (
      NEW.claim_public_id IS NULL
      OR NEW.claim_owner_public_id IS NULL
      OR NEW.claim_expires_at_utc IS NULL
    )
  )
  OR (
    NEW.status <> 'applying'
    AND (
      NEW.claim_public_id IS NOT NULL
      OR NEW.claim_owner_public_id IS NOT NULL
      OR NEW.claim_expires_at_utc IS NOT NULL
    )
  )
  OR (NEW.status = 'retry' AND NEW.next_attempt_at_utc IS NULL)
  OR (NEW.status <> 'retry' AND NEW.next_attempt_at_utc IS NOT NULL)
  OR (
    NEW.status IN ('retry', 'dead_letter')
    AND (NEW.error_code IS NULL OR NEW.error_hash IS NULL)
  )
BEGIN
  SELECT CASE
    WHEN NEW.status = 'applying' OR NEW.claim_public_id IS NOT NULL
      OR NEW.claim_owner_public_id IS NOT NULL OR NEW.claim_expires_at_utc IS NOT NULL
      THEN RAISE(ABORT, 'canonical sync claim evidence is inconsistent')
    WHEN NEW.status = 'retry' OR NEW.next_attempt_at_utc IS NOT NULL
      THEN RAISE(ABORT, 'canonical sync retry evidence is inconsistent')
    ELSE RAISE(ABORT, 'canonical sync terminal error evidence is incomplete')
  END;
END;
