-- Migration: 0392_lab_reagent_analyzer_assignments.sql
-- Purpose: Track which analyzer/machine or analyzer-location currently uses a canonical lab reagent stock lot.

CREATE TABLE IF NOT EXISTS lab_reagent_analyzer_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  stock_id INTEGER NOT NULL REFERENCES InventoryStock(StockId),
  inventory_item_id INTEGER NOT NULL,
  consumable_id INTEGER NOT NULL REFERENCES lab_consumables(id),
  machine_id INTEGER REFERENCES lab_machines(id),
  location_id INTEGER REFERENCES lab_consumable_locations(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ended')),
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  assigned_by TEXT,
  unassigned_at DATETIME,
  unassigned_by TEXT,
  remarks TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CHECK(machine_id IS NOT NULL OR location_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_lab_reagent_analyzer_assignments_tenant
  ON lab_reagent_analyzer_assignments(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_lab_reagent_analyzer_assignments_stock
  ON lab_reagent_analyzer_assignments(tenant_id, stock_id, status);
CREATE INDEX IF NOT EXISTS idx_lab_reagent_analyzer_assignments_machine
  ON lab_reagent_analyzer_assignments(tenant_id, machine_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_reagent_analyzer_assignments_active_stock
  ON lab_reagent_analyzer_assignments(tenant_id, stock_id)
  WHERE status = 'active';
