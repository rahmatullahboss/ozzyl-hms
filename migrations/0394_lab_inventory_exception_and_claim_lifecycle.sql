-- Migration: 0394_lab_inventory_exception_and_claim_lifecycle.sql
-- Purpose: Make lab reagent consumption idempotency retry-safe and surface stock/mapping failures to admin/lab manager.

CREATE INDEX IF NOT EXISTS idx_lab_consumable_claim_status
  ON lab_consumable_consumption_claims(tenant_id, status, updated_at);

CREATE TABLE IF NOT EXISTS lab_inventory_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  lab_order_id INTEGER,
  lab_order_item_id INTEGER,
  lab_test_id INTEGER,
  consumable_id INTEGER,
  source_event TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'error' CHECK(severity IN ('warning','error')),
  reason TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','ignored')),
  created_by TEXT,
  resolved_by TEXT,
  resolved_at DATETIME,
  resolution_remarks TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_inventory_exceptions_open
  ON lab_inventory_exceptions(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_lab_inventory_exceptions_order_item
  ON lab_inventory_exceptions(tenant_id, lab_order_item_id, status);
CREATE INDEX IF NOT EXISTS idx_lab_inventory_exceptions_consumable
  ON lab_inventory_exceptions(tenant_id, consumable_id, status);
