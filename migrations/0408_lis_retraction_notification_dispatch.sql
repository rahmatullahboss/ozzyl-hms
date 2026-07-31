-- Migration 0408: durable per-recipient dispatch for LIS result retraction notifications.

ALTER TABLE notifications ADD COLUMN dedupe_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_notifications_dedupe_key
  ON notifications(tenant_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

ALTER TABLE lis_result_retraction_notification_outbox ADD COLUMN manual_retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lis_result_retraction_notification_outbox ADD COLUMN last_manual_retry_by INTEGER REFERENCES users(id);
ALTER TABLE lis_result_retraction_notification_outbox ADD COLUMN last_manual_retry_reason TEXT;
ALTER TABLE lis_result_retraction_notification_outbox ADD COLUMN last_manual_retry_at DATETIME;

CREATE TABLE IF NOT EXISTS patient_portal_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  category TEXT NOT NULL DEFAULT 'lab_result_retraction'
    CHECK (category IN ('lab_result_retraction')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  dedupe_key TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  read_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_patient_portal_notifications_inbox
  ON patient_portal_notifications(tenant_id, patient_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS lis_result_retraction_notification_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  outbox_id INTEGER NOT NULL REFERENCES lis_result_retraction_notification_outbox(id),
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'portal')),
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('user', 'patient')),
  recipient_id INTEGER NOT NULL,
  delivery_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  processing_started_at DATETIME,
  next_attempt_at DATETIME,
  provider_message_id TEXT,
  last_error TEXT,
  sent_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, delivery_key),
  UNIQUE (outbox_id, channel, recipient_type, recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_lis_retraction_delivery_dispatch
  ON lis_result_retraction_notification_deliveries(status, next_attempt_at, processing_started_at, created_at);
CREATE INDEX IF NOT EXISTS idx_lis_retraction_delivery_outbox
  ON lis_result_retraction_notification_deliveries(outbox_id, status);

CREATE TABLE IF NOT EXISTS lis_result_retraction_notification_retry_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  outbox_id INTEGER NOT NULL REFERENCES lis_result_retraction_notification_outbox(id),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed', 'completed')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_lis_retraction_notification_retry_claim
  ON lis_result_retraction_notification_retry_commands(tenant_id, outbox_id)
  WHERE status = 'claimed';

CREATE TRIGGER IF NOT EXISTS trg_lis_retraction_retry_command_identity_immutable
BEFORE UPDATE ON lis_result_retraction_notification_retry_commands
FOR EACH ROW
WHEN
  NEW.tenant_id IS NOT OLD.tenant_id OR
  NEW.outbox_id IS NOT OLD.outbox_id OR
  NEW.requested_by IS NOT OLD.requested_by OR
  NEW.reason IS NOT OLD.reason OR
  NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'LIS retraction notification retry command evidence is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_lis_retraction_retry_completion_requires_reset
BEFORE UPDATE OF status ON lis_result_retraction_notification_retry_commands
FOR EACH ROW
WHEN NEW.status = 'completed'
BEGIN
  SELECT CASE WHEN
    OLD.status <> 'claimed' OR
    NEW.completed_at IS NULL OR
    NOT EXISTS (
      SELECT 1
      FROM lis_result_retraction_notification_outbox outbox
      WHERE outbox.id = NEW.outbox_id
        AND outbox.tenant_id = NEW.tenant_id
        AND outbox.status = 'pending'
        AND outbox.last_manual_retry_by = NEW.requested_by
        AND outbox.last_manual_retry_reason = NEW.reason
    ) OR
    NOT EXISTS (
      SELECT 1
      FROM lis_result_retraction_notification_deliveries delivery
      WHERE delivery.outbox_id = NEW.outbox_id
        AND delivery.tenant_id = NEW.tenant_id
    ) OR
    EXISTS (
      SELECT 1
      FROM lis_result_retraction_notification_deliveries delivery
      WHERE delivery.outbox_id = NEW.outbox_id
        AND delivery.tenant_id = NEW.tenant_id
        AND delivery.status = 'failed'
    )
  THEN RAISE(ABORT, 'LIS retraction notification retry reset is incomplete') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_lis_retraction_delivery_identity_immutable
BEFORE UPDATE ON lis_result_retraction_notification_deliveries
FOR EACH ROW
WHEN
  NEW.tenant_id IS NOT OLD.tenant_id OR
  NEW.outbox_id IS NOT OLD.outbox_id OR
  NEW.channel IS NOT OLD.channel OR
  NEW.recipient_type IS NOT OLD.recipient_type OR
  NEW.recipient_id IS NOT OLD.recipient_id OR
  NEW.delivery_key IS NOT OLD.delivery_key OR
  NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'LIS retraction notification delivery identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_patient_portal_notification_evidence_immutable
BEFORE UPDATE ON patient_portal_notifications
FOR EACH ROW
WHEN
  NEW.tenant_id IS NOT OLD.tenant_id OR
  NEW.patient_id IS NOT OLD.patient_id OR
  NEW.category IS NOT OLD.category OR
  NEW.title IS NOT OLD.title OR
  NEW.message IS NOT OLD.message OR
  NEW.link IS NOT OLD.link OR
  NEW.metadata_json IS NOT OLD.metadata_json OR
  NEW.dedupe_key IS NOT OLD.dedupe_key OR
  NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'Patient portal notification evidence is immutable');
END;
