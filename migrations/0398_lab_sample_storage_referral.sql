-- Add sample storage and referral tracking fields on the existing lab item lifecycle.
-- This intentionally extends lab_order_items + lab_workflow_events instead of creating a second sample lifecycle.

ALTER TABLE lab_order_items ADD COLUMN sample_storage_fridge TEXT;
ALTER TABLE lab_order_items ADD COLUMN sample_storage_rack TEXT;
ALTER TABLE lab_order_items ADD COLUMN sample_storage_box TEXT;
ALTER TABLE lab_order_items ADD COLUMN sample_storage_position TEXT;
ALTER TABLE lab_order_items ADD COLUMN sample_storage_condition TEXT;
ALTER TABLE lab_order_items ADD COLUMN sample_stored_at DATETIME;
ALTER TABLE lab_order_items ADD COLUMN sample_stored_by INTEGER REFERENCES users(id);

ALTER TABLE lab_order_items ADD COLUMN referral_lab_name TEXT;
ALTER TABLE lab_order_items ADD COLUMN referral_contact TEXT;
ALTER TABLE lab_order_items ADD COLUMN referral_tracking_no TEXT;
ALTER TABLE lab_order_items ADD COLUMN referral_reason TEXT;
ALTER TABLE lab_order_items ADD COLUMN referral_status TEXT;
ALTER TABLE lab_order_items ADD COLUMN referred_at DATETIME;
ALTER TABLE lab_order_items ADD COLUMN referred_by INTEGER REFERENCES users(id);
ALTER TABLE lab_order_items ADD COLUMN expected_return_at DATETIME;
ALTER TABLE lab_order_items ADD COLUMN returned_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_lab_order_items_storage_location
  ON lab_order_items(tenant_id, sample_storage_fridge, sample_storage_rack, sample_storage_box);

CREATE INDEX IF NOT EXISTS idx_lab_order_items_referral_status
  ON lab_order_items(tenant_id, referral_status, referred_at);
