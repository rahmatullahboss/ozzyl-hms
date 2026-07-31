-- Push notification subscriptions (Web Push API)
-- Stores endpoint + keys for each user so the Worker can send push notifications.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id    TEXT    NOT NULL,
  user_id      INTEGER NOT NULL,
  endpoint     TEXT    NOT NULL,
  p256dh_key   TEXT    NOT NULL,
  auth_key     TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),

  -- One subscription per endpoint per tenant (a user might have multiple devices)
  UNIQUE(tenant_id, endpoint)
);

-- Index for fast lookup when sending notifications to an entire tenant
CREATE INDEX IF NOT EXISTS idx_push_sub_tenant ON push_subscriptions(tenant_id);
