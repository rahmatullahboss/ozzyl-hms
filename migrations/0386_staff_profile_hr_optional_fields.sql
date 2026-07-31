-- Staff profile optional HR/contact fields
-- These fields are captured by Staff Management and can be filled later.

ALTER TABLE staff ADD COLUMN emergency_contact TEXT;
ALTER TABLE staff ADD COLUMN blood_group TEXT;
ALTER TABLE staff ADD COLUMN category TEXT;
ALTER TABLE staff ADD COLUMN biometric_device_id TEXT;
ALTER TABLE staff ADD COLUMN shift_type TEXT;
