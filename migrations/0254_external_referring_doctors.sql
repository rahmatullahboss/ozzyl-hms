-- Migration: External Referring Doctors
-- Description: Creates table for tracking external/outside referring doctors
-- and adds reference to appointments table.

CREATE TABLE IF NOT EXISTS external_referring_doctors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  chamber TEXT,
  specialty TEXT,
  tenant_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX idx_external_referring_doctors_tenant ON external_referring_doctors (tenant_id);
CREATE INDEX idx_external_referring_doctors_name ON external_referring_doctors (tenant_id, name);

ALTER TABLE appointments ADD COLUMN external_referring_doctor_id INTEGER;
CREATE INDEX idx_appointments_ext_ref_doctor ON appointments (external_referring_doctor_id);
