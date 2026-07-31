CREATE TABLE IF NOT EXISTS user_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'web',
  push_token TEXT,
  last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(patient_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_user_devices_patient ON user_devices(patient_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_token ON user_devices(push_token);
