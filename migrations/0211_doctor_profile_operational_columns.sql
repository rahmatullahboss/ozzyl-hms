-- Migration: 0211_doctor_profile_operational_columns.sql
-- Purpose: Columns used by doctor search, billing counter visit context, and marketplace profile forms.
-- Backup note: run a D1 backup/export before applying this migration to production.

ALTER TABLE doctors ADD COLUMN department TEXT;
ALTER TABLE doctors ADD COLUMN bio TEXT;
ALTER TABLE doctors ADD COLUMN is_available INTEGER NOT NULL DEFAULT 1;
ALTER TABLE doctors ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_doctors_tenant_display
  ON doctors(tenant_id, is_active, display_order, name);
