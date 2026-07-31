-- Migration: 0242_reception_doctor_status_enhanced
-- Description: Enhanced doctor status with types, reasons, and scheduling for timeline

-- Add new columns for enhanced status management and timeline
ALTER TABLE doctor_daily_status ADD COLUMN status_type TEXT DEFAULT 'available';
ALTER TABLE doctor_daily_status ADD COLUMN reason TEXT;
ALTER TABLE doctor_daily_status ADD COLUMN is_not_coming INTEGER DEFAULT 0;
ALTER TABLE doctor_daily_status ADD COLUMN start_time TEXT;
ALTER TABLE doctor_daily_status ADD COLUMN end_time TEXT;

-- Create index for status_type filtering
CREATE INDEX IF NOT EXISTS idx_doctor_daily_status_type
  ON doctor_daily_status(tenant_id, status_date, status_type);