-- Migration: Create pharmacy_sales and pharmacy_sale_items tables
-- Required by reportPharmacy.ts dispensing-summary, top-dispensed reports

CREATE TABLE IF NOT EXISTS pharmacy_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER,
  patient_name TEXT,
  invoice_no TEXT,
  total_amount REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  net_amount REAL NOT NULL DEFAULT 0,
  payment_method TEXT DEFAULT 'cash',
  status TEXT DEFAULT 'completed',
  sold_by INTEGER,
  remarks TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_sales_tenant ON pharmacy_sales(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_sales_patient ON pharmacy_sales(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_sales_date ON pharmacy_sales(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS pharmacy_sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES pharmacy_sales(id),
  medicine_id INTEGER REFERENCES medicines(id),
  medicine_name TEXT NOT NULL,
  batch_no TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  tenant_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_sale_items_sale ON pharmacy_sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_sale_items_tenant ON pharmacy_sale_items(tenant_id);
