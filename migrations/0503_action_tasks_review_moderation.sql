-- =============================================================================
-- Unified Action Center: persistent tasks and structured review moderation
--
-- Tasks store assignment/reminder state only. They do not own approval,
-- exception, collection, invoice, payment, or adjustment authority.
-- Review compatibility columns keep the currently deployed moderation routes
-- operational while the structured UTC/audit contract is adopted.
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE admin_action_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  description TEXT CHECK(description IS NULL OR length(description) <= 4000),
  source_type TEXT,
  source_public_id TEXT,
  source_href TEXT CHECK(source_href IS NULL OR length(trim(source_href)) > 0),
  source_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(source_metadata_json)),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('critical','high','medium','low')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','completed','cancelled')),
  assigned_to INTEGER,
  due_at_utc TEXT,
  completed_by INTEGER,
  completed_at_utc TEXT,
  completion_note TEXT CHECK(completion_note IS NULL OR length(completion_note) <= 2000),
  created_by INTEGER,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(
    (source_type IS NULL AND source_public_id IS NULL)
    OR (
      source_type IN ('exception','collection','manual')
      AND source_public_id IS NOT NULL
      AND length(trim(source_public_id)) > 0
    )
  ),
  CHECK(due_at_utc IS NULL OR substr(due_at_utc, -1) = 'Z'),
  CHECK(completed_at_utc IS NULL OR substr(completed_at_utc, -1) = 'Z'),
  CHECK(substr(created_at_utc, -1) = 'Z'),
  CHECK(substr(updated_at_utc, -1) = 'Z'),
  CHECK(
    (
      status = 'completed'
      AND completed_by IS NOT NULL
      AND completed_at_utc IS NOT NULL
      AND completion_note IS NOT NULL
      AND length(trim(completion_note)) > 0
    )
    OR (
      status <> 'completed'
      AND completed_by IS NULL
      AND completed_at_utc IS NULL
      AND completion_note IS NULL
    )
  ),
  UNIQUE(tenant_id, id)
);

CREATE UNIQUE INDEX uq_admin_action_tasks_source
  ON admin_action_tasks(tenant_id, source_type, source_public_id)
  WHERE source_type IS NOT NULL
    AND source_public_id IS NOT NULL
    AND status <> 'cancelled';

CREATE INDEX idx_admin_action_tasks_status_due
  ON admin_action_tasks(tenant_id, status, due_at_utc, priority, updated_at_utc);

CREATE INDEX idx_admin_action_tasks_assignee_status
  ON admin_action_tasks(tenant_id, assigned_to, status, due_at_utc, updated_at_utc);

CREATE TABLE admin_action_task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  task_id INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK(length(trim(event_type)) > 0),
  actor_id INTEGER,
  old_status TEXT,
  new_status TEXT,
  note TEXT CHECK(note IS NULL OR length(note) <= 2000),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(old_status IS NULL OR old_status IN ('open','in_progress','completed','cancelled')),
  CHECK(new_status IS NULL OR new_status IN ('open','in_progress','completed','cancelled')),
  CHECK(substr(created_at_utc, -1) = 'Z'),
  FOREIGN KEY(tenant_id, task_id)
    REFERENCES admin_action_tasks(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_admin_action_task_events_task_created
  ON admin_action_task_events(tenant_id, task_id, created_at_utc, id);

-- Compatibility columns used by the currently deployed moderation routes.
ALTER TABLE provider_reviews ADD COLUMN moderation_reason TEXT;
ALTER TABLE provider_reviews ADD COLUMN moderated_at TEXT;
ALTER TABLE provider_reviews ADD COLUMN provider_reply TEXT
  CHECK(provider_reply IS NULL OR length(provider_reply) <= 4000);
ALTER TABLE provider_reviews ADD COLUMN provider_reply_at TEXT;
ALTER TABLE provider_reviews ADD COLUMN provider_reply_by INTEGER;

-- Structured moderation columns used by the new audited workflow.
ALTER TABLE provider_reviews ADD COLUMN moderation_reason_code TEXT
  CHECK(
    moderation_reason_code IS NULL
    OR moderation_reason_code IN (
      'abusive_language',
      'personal_information',
      'spam',
      'irrelevant_content',
      'conflict_of_interest',
      'fraudulent_review',
      'other'
    )
  );
ALTER TABLE provider_reviews ADD COLUMN moderation_note TEXT
  CHECK(moderation_note IS NULL OR length(moderation_note) <= 2000);
ALTER TABLE provider_reviews ADD COLUMN moderated_by INTEGER;
ALTER TABLE provider_reviews ADD COLUMN moderated_at_utc TEXT
  CHECK(moderated_at_utc IS NULL OR substr(moderated_at_utc, -1) = 'Z');
ALTER TABLE provider_reviews ADD COLUMN provider_reply_at_utc TEXT
  CHECK(provider_reply_at_utc IS NULL OR substr(provider_reply_at_utc, -1) = 'Z');

CREATE UNIQUE INDEX uq_provider_reviews_tenant_id
  ON provider_reviews(target_tenant_id, id);

CREATE TABLE provider_review_moderation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  review_id INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('approved','rejected','reply_posted')),
  actor_id INTEGER NOT NULL,
  reason_code TEXT,
  note TEXT CHECK(note IS NULL OR length(note) <= 2000),
  old_state INTEGER,
  new_state INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(
    reason_code IS NULL
    OR reason_code IN (
      'abusive_language',
      'personal_information',
      'spam',
      'irrelevant_content',
      'conflict_of_interest',
      'fraudulent_review',
      'other'
    )
  ),
  CHECK(
    event_type <> 'rejected'
    OR (reason_code IS NOT NULL AND length(trim(reason_code)) > 0)
  ),
  CHECK(old_state IS NULL OR old_state IN (-1,0,1)),
  CHECK(new_state IS NULL OR new_state IN (-1,0,1)),
  CHECK(
    (
      event_type = 'approved'
      AND old_state IS 0
      AND new_state IS 1
      AND reason_code IS NULL
    )
    OR (
      event_type = 'rejected'
      AND old_state IS 0
      AND new_state IS -1
      AND reason_code IS NOT NULL
    )
    OR (
      event_type = 'reply_posted'
      AND old_state IS NOT NULL
      AND new_state IS NOT NULL
      AND old_state = new_state
      AND reason_code IS NULL
    )
  ),
  CHECK(substr(created_at_utc, -1) = 'Z'),
  FOREIGN KEY(tenant_id, review_id)
    REFERENCES provider_reviews(target_tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_provider_review_moderation_events_review_created
  ON provider_review_moderation_events(tenant_id, review_id, created_at_utc, id);
