-- Lab inventory policy controls when mapped reagents are consumed.
-- Default is billing-time for no-LIS/manual-report hospitals.
CREATE TABLE IF NOT EXISTS lab_inventory_policy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL UNIQUE,
  reagent_consumption_timing TEXT NOT NULL DEFAULT 'billing' CHECK (reagent_consumption_timing IN ('billing', 'result')),
  updated_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_inventory_policy_tenant ON lab_inventory_policy(tenant_id);
