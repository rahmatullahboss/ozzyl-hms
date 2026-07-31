-- Migration 0159: Bed Auto-Charges
-- Tracks bed assignment history and auto-calculates charges

-- Add rate_per_day to beds table
ALTER TABLE beds ADD COLUMN rate_per_day REAL DEFAULT 0;

-- Create patient_bed_infos to track bed assignment history
CREATE TABLE IF NOT EXISTS patient_bed_infos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  admission_id INTEGER NOT NULL,
  bed_id INTEGER NOT NULL,
  ward_name TEXT,
  bed_number TEXT,
  bed_type TEXT,
  rate_per_day REAL NOT NULL DEFAULT 0,
  started_on TEXT NOT NULL DEFAULT (datetime('now')),
  ended_on TEXT,
  days INTEGER DEFAULT 0,
  charge_amount REAL DEFAULT 0,
  is_billed INTEGER DEFAULT 0,
  billed_bill_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pbi_tenant ON patient_bed_infos(tenant_id, admission_id);
CREATE INDEX IF NOT EXISTS idx_pbi_patient ON patient_bed_infos(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_pbi_bed ON patient_bed_infos(tenant_id, bed_id);
CREATE INDEX IF NOT EXISTS idx_pbi_unbilled ON patient_bed_infos(tenant_id, is_billed, ended_on);

-- Create bed_charge_log for audit/debugging
CREATE TABLE IF NOT EXISTS bed_charge_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  patient_bed_info_id INTEGER NOT NULL,
  admission_id INTEGER NOT NULL,
  bed_id INTEGER NOT NULL,
  old_days INTEGER,
  new_days INTEGER,
  old_amount REAL,
  new_amount REAL,
  reason TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bcl_admission ON bed_charge_logs(tenant_id, admission_id);
