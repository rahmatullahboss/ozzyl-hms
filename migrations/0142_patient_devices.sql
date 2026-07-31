-- Device Tracking (Implants & Worn Medical Devices)
-- Tracks devices implanted in or worn by patients

CREATE TABLE IF NOT EXISTS patient_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  -- Device info
  device_type TEXT NOT NULL,              -- 'implant', 'prosthetic', 'wearable', 'monitoring', 'other'
  device_name TEXT NOT NULL,              -- e.g. 'Cardiac Pacemaker', 'Hip Prosthesis'
  manufacturer TEXT,
  model_number TEXT,
  serial_number TEXT,
  lot_number TEXT,
  udi TEXT,                               -- Unique Device Identifier (FDA UDI)
  -- Clinical
  body_site TEXT,                         -- where implanted/worn
  implant_date TEXT,
  removal_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',  -- 'active', 'removed', 'malfunctioning', 'recalled'
  reason TEXT,                            -- reason for implantation
  -- Provider
  implanted_by TEXT,                      -- doctor name
  implanted_by_id TEXT,                   -- staff ID
  facility TEXT,                          -- where implanted
  -- Notes
  notes TEXT,
  mri_safe TEXT,                          -- 'safe', 'conditional', 'unsafe', 'unknown'
  -- Audit
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_patient_devices_tenant ON patient_devices(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_devices_status ON patient_devices(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_patient_devices_udi ON patient_devices(udi);
