CREATE TABLE IF NOT EXISTS fraction_percents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  service_item_id INTEGER,
  bill_item_category TEXT,
  hospital_percent REAL NOT NULL DEFAULT 60,
  doctor_percent REAL NOT NULL DEFAULT 40,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS fraction_calculations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  bill_id INTEGER NOT NULL,
  invoice_item_id INTEGER,
  doctor_id INTEGER NOT NULL,
  gross_amount REAL NOT NULL,
  hospital_amount REAL NOT NULL,
  doctor_amount REAL NOT NULL,
  fraction_percent_id INTEGER,
  status TEXT NOT NULL DEFAULT 'calculated',
  settled_date TEXT,
  settlement_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT,
  FOREIGN KEY (bill_id) REFERENCES bills(id),
  FOREIGN KEY (fraction_percent_id) REFERENCES fraction_percents(id)
);

CREATE INDEX idx_fraction_percents_tenant ON fraction_percents(tenant_id);
CREATE INDEX idx_fraction_calc_bill ON fraction_calculations(tenant_id, bill_id);
CREATE INDEX idx_fraction_calc_doctor ON fraction_calculations(tenant_id, doctor_id);
CREATE INDEX idx_fraction_calc_status ON fraction_calculations(tenant_id, status);
