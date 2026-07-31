-- Migration 0019: Prescription Sharing & Delivery Workflow
-- Adds share tokens for patient-facing links and delivery tracking

ALTER TABLE prescriptions ADD COLUMN share_token TEXT;
ALTER TABLE prescriptions ADD COLUMN share_expires_at TEXT;
ALTER TABLE prescriptions ADD COLUMN delivery_status TEXT DEFAULT 'none';  -- none, ordered, dispatched, delivered
ALTER TABLE prescriptions ADD COLUMN delivery_address TEXT;
ALTER TABLE prescriptions ADD COLUMN delivery_phone TEXT;

CREATE INDEX IF NOT EXISTS idx_rx_share_token ON prescriptions(share_token);
