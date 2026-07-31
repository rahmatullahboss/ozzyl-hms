CREATE TABLE IF NOT EXISTS doctor_daily_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  doctor_id INTEGER NOT NULL,
  status_date TEXT NOT NULL,
  is_available INTEGER NOT NULL DEFAULT 1,
  max_serial INTEGER,
  updated_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, doctor_id, status_date),
  FOREIGN KEY (doctor_id) REFERENCES doctors(id)
);

CREATE INDEX IF NOT EXISTS idx_doctor_daily_status_tenant_date
  ON doctor_daily_status(tenant_id, status_date);
