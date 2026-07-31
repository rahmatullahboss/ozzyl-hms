-- Migration 0190: Fix queue_entries ↔ appointments bridge for check-in flow
-- Applied: 2026-05-02
-- Fix: Queue entries missing appointment_id column causes check-in INSERT to fail (500)
--       and queue completion sync cannot find linked appointment

-- Add appointment_id to queue_entries (bridge for appointment-based check-in)
ALTER TABLE queue_entries ADD COLUMN appointment_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_queue_entry_appointment ON queue_entries(appointment_id);
