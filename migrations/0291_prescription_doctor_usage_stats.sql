-- Doctor-specific prescription quick-pick usage counters.

CREATE TABLE IF NOT EXISTS prescription_medicine_usage_stats (
  tenant_id TEXT NOT NULL,
  doctor_id INTEGER NOT NULL,
  medicine_key TEXT NOT NULL,
  medicine_name TEXT NOT NULL,
  generic_name TEXT,
  strength TEXT,
  dosage_form TEXT,
  manufacturer TEXT,
  default_frequency TEXT,
  default_duration TEXT,
  default_instructions TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT,
  PRIMARY KEY (tenant_id, doctor_id, medicine_key)
);

CREATE INDEX IF NOT EXISTS idx_rx_medicine_usage_rank
  ON prescription_medicine_usage_stats(tenant_id, doctor_id, usage_count DESC, last_used_at DESC);

CREATE TABLE IF NOT EXISTS prescription_lab_test_usage_stats (
  tenant_id TEXT NOT NULL,
  doctor_id INTEGER NOT NULL,
  test_name TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT,
  PRIMARY KEY (tenant_id, doctor_id, test_name)
);

CREATE INDEX IF NOT EXISTS idx_rx_lab_test_usage_rank
  ON prescription_lab_test_usage_stats(tenant_id, doctor_id, usage_count DESC, last_used_at DESC);
