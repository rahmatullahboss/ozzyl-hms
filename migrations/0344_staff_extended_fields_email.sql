-- Migration: 0344_staff_extended_fields_danphe_parity.sql
-- DanpheEMR parity: add identity/contact columns to staff
-- Mirrors fields from the DanpheEMR Employee model: Email, DateOfBirth, Gender, Salutation
-- This migration enables the Staff Management UI to capture these on add/edit
-- and the API to persist + return them on the staff endpoints.

ALTER TABLE staff ADD COLUMN email TEXT;
ALTER TABLE staff ADD COLUMN date_of_birth DATE;
ALTER TABLE staff ADD COLUMN gender TEXT CHECK(gender IN ('Male', 'Female', 'Other'));
ALTER TABLE staff ADD COLUMN salutation TEXT CHECK(salutation IN ('Mr', 'Mrs', 'Ms', 'Dr'));

-- For fresh installs, the base tenant-schema.sql is also updated (kept in sync).
