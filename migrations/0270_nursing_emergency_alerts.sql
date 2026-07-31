CREATE TABLE IF NOT EXISTS nursing_emergency_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  admission_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  acknowledged_by INTEGER,
  acknowledged_at TEXT,
  resolved_by INTEGER,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_emergency_alerts_tenant ON nursing_emergency_alerts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_emergency_alerts_patient ON nursing_emergency_alerts(patient_id, tenant_id);
