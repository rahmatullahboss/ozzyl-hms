-- 0296_bills_referred_by_and_hospitals.sql
-- Adds referral_hospitals table for "Referred by" hospital picker on test bills,
-- and two new columns to bills to store the referrer type + hospital id.

CREATE TABLE IF NOT EXISTS referral_hospitals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  short_code TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_referral_hospitals_tenant_active
  ON referral_hospitals(tenant_id, is_active);

ALTER TABLE bills ADD COLUMN referred_by_type TEXT;
ALTER TABLE bills ADD COLUMN referred_by_hospital_id INTEGER
  REFERENCES referral_hospitals(id);
