-- Safe version of 0157_visit_services_layer.sql (production-hotfix)
-- Skips columns that already exist in production schema

CREATE TABLE visit_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  visit_id INTEGER NOT NULL REFERENCES visits(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  service_type TEXT NOT NULL CHECK(service_type IN ('doctor_visit','test','procedure','admission','medicine','package','other')),
  description TEXT,
  service_item_id INTEGER REFERENCES billing_service_items(id),
  doctor_id INTEGER REFERENCES doctors(id),
  amount REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1,
  total_amount REAL NOT NULL DEFAULT 0,
  reference_type TEXT,
  reference_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','billed','cancelled','refunded')),
  bill_id INTEGER REFERENCES bills(id),
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_visit_services_tenant ON visit_services(tenant_id);
CREATE INDEX idx_visit_services_visit ON visit_services(visit_id);
CREATE INDEX idx_visit_services_patient ON visit_services(patient_id);
CREATE INDEX idx_visit_services_status ON visit_services(tenant_id, status);
CREATE INDEX idx_visit_services_bill ON visit_services(bill_id);
CREATE INDEX idx_visit_services_created ON visit_services(tenant_id, created_at);

CREATE TABLE procedure_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  order_no TEXT NOT NULL,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  visit_id INTEGER REFERENCES visits(id),
  service_item_id INTEGER REFERENCES billing_service_items(id),
  procedure_name TEXT NOT NULL,
  instructions TEXT,
  ordered_by INTEGER,
  performed_by INTEGER,
  status TEXT NOT NULL DEFAULT 'ordered' CHECK(status IN ('ordered','in_progress','completed','cancelled')),
  ordered_at TEXT DEFAULT (datetime('now')),
  performed_at TEXT,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_procedure_orders_tenant ON procedure_orders(tenant_id);
CREATE INDEX idx_procedure_orders_patient ON procedure_orders(patient_id);
CREATE INDEX idx_procedure_orders_visit ON procedure_orders(visit_id);
CREATE INDEX idx_procedure_orders_status ON procedure_orders(tenant_id, status);
CREATE INDEX idx_procedure_orders_order_no ON procedure_orders(tenant_id, order_no);

ALTER TABLE payments ADD COLUMN payment_source TEXT DEFAULT 'reception' CHECK(payment_source IN ('reception','pharmacy','lab','ipd','ot','other'));
ALTER TABLE bills ADD COLUMN counter_id INTEGER;
