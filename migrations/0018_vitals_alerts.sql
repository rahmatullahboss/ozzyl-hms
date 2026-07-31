-- Migration 0018: Vital Alert Rules & Alerts History
-- Enables RPM-style threshold monitoring with auto-alert generation

-- 1. Alert rule definitions (per-tenant or global defaults with tenant_id=0)
CREATE TABLE IF NOT EXISTS vital_alert_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 0,   -- 0 = global default
  vital_type TEXT NOT NULL,               -- systolic, diastolic, heart_rate, spo2, temperature, respiratory_rate
  min_value REAL,
  max_value REAL,
  severity TEXT NOT NULL DEFAULT 'warning',  -- info, warning, critical
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Alerts generated when vitals breach rules
CREATE TABLE IF NOT EXISTS vital_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  vital_id INTEGER NOT NULL,              -- FK to patient_vitals.id
  rule_id INTEGER NOT NULL,               -- FK to vital_alert_rules.id
  vital_type TEXT NOT NULL,
  recorded_value REAL NOT NULL,
  threshold_min REAL,
  threshold_max REAL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',   -- active, acknowledged, resolved
  acknowledged_by TEXT,
  acknowledged_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vital_alerts_tenant ON vital_alerts(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_vital_alerts_patient ON vital_alerts(tenant_id, patient_id, status);
CREATE INDEX IF NOT EXISTS idx_vital_alert_rules_tenant ON vital_alert_rules(tenant_id, vital_type, is_active);

-- 3. Seed default global alert rules (tenant_id=0 means all tenants inherit)
INSERT INTO vital_alert_rules (tenant_id, vital_type, min_value, max_value, severity) VALUES
  (0, 'systolic',          90,  140, 'warning'),
  (0, 'systolic',          80,  180, 'critical'),
  (0, 'diastolic',         60,   90, 'warning'),
  (0, 'diastolic',         50,  110, 'critical'),
  (0, 'heart_rate',        50,  100, 'warning'),
  (0, 'heart_rate',        40,  130, 'critical'),
  (0, 'spo2',              92,  100, 'warning'),
  (0, 'spo2',              88,  100, 'critical'),
  (0, 'temperature',     36.0, 38.0, 'warning'),
  (0, 'temperature',     35.0, 39.5, 'critical'),
  (0, 'respiratory_rate',  12,   20, 'warning'),
  (0, 'respiratory_rate',   8,   30, 'critical');
