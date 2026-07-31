-- Migration: 0155_hr_leave_rejection_reason.sql
-- Add rejection_reason column to hr_leave_requests

ALTER TABLE hr_leave_requests ADD COLUMN rejection_reason TEXT;
