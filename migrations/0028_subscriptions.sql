-- Migration 0028: Subscription and pricing infrastructure
-- Adds trial/billing fields to tenants and subscription history tracking

-- 1. Add trial and billing columns to tenants
ALTER TABLE tenants ADD COLUMN trial_ends_at DATETIME;
ALTER TABLE tenants ADD COLUMN plan_price INTEGER DEFAULT 0;
ALTER TABLE tenants ADD COLUMN billing_cycle TEXT DEFAULT 'monthly';
ALTER TABLE tenants ADD COLUMN plan_started_at DATETIME;
ALTER TABLE tenants ADD COLUMN addons TEXT DEFAULT '[]';

-- 2. Subscription history for audit trail
CREATE TABLE IF NOT EXISTS subscription_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  plan TEXT NOT NULL,
  plan_price INTEGER NOT NULL DEFAULT 0,
  billing_cycle TEXT DEFAULT 'monthly',
  addons TEXT DEFAULT '[]',
  action TEXT NOT NULL,  -- 'trial_start', 'subscribe', 'upgrade', 'downgrade', 'cancel', 'addon_add', 'addon_remove'
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- 3. Update existing tenants to have trial info (set 30 days from now for active ones)
UPDATE tenants SET
  trial_ends_at = datetime('now', '+30 days'),
  plan_price = 0,
  billing_cycle = 'monthly',
  plan_started_at = created_at
WHERE trial_ends_at IS NULL AND status = 'active';
