-- Inventory and lab reagent integrity hardening.
-- InventoryStock remains the authoritative quantity ledger for linked reagents.

CREATE TABLE IF NOT EXISTS lab_consumable_mapping_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  lab_order_id INTEGER,
  lab_order_item_id INTEGER NOT NULL,
  lab_test_id INTEGER NOT NULL,
  consumable_id INTEGER NOT NULL,
  inventory_item_id INTEGER,
  expected_quantity REAL NOT NULL DEFAULT 0,
  committed_quantity REAL NOT NULL DEFAULT 0,
  projected_quantity REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'partial', 'committed', 'failed', 'reversed')),
  last_error TEXT,
  created_by TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, lab_order_item_id, consumable_id)
);

CREATE INDEX IF NOT EXISTS idx_lab_consumable_mapping_progress_status
  ON lab_consumable_mapping_progress(tenant_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_lab_consumable_mapping_progress_order
  ON lab_consumable_mapping_progress(tenant_id, lab_order_item_id, consumable_id);

CREATE TABLE IF NOT EXISTS inventory_demand_source_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  inventory_item_id INTEGER NOT NULL,
  demand_date DATE NOT NULL,
  source_scope TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  quantity REAL NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_demand_source_event_item_date
  ON inventory_demand_source_event(tenant_id, inventory_item_id, demand_date);
