-- Inventory issue request-level atomicity and idempotency.
-- Migration 0400 protects individual allocations; this migration adds whole-request identity and rollback guards.

CREATE TABLE IF NOT EXISTS inventory_issue_operation (
  operation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','processing','completed','failed','recovered')),
  consumption_id INTEGER,
  issue_no TEXT,
  response_json TEXT,
  last_error TEXT,
  attempt_no INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_inventory_issue_operation_status
  ON inventory_issue_operation(tenant_id, status, updated_at);

CREATE TABLE IF NOT EXISTS inventory_issue_batch_guard (
  tenant_id TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  step_key TEXT NOT NULL,
  assertion_value INTEGER NOT NULL CHECK(assertion_value = 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, operation_key, step_key)
);

ALTER TABLE InventoryConsumption ADD COLUMN OperationKey TEXT;
ALTER TABLE InventoryConsumption ADD COLUMN OperationStatus TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE InventoryConsumptionItem ADD COLUMN OperationAllocationKey TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_consumption_operation_key
  ON InventoryConsumption(tenant_id, OperationKey)
  WHERE OperationKey IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_consumption_item_allocation_key
  ON InventoryConsumptionItem(ConsumptionId, OperationAllocationKey)
  WHERE OperationAllocationKey IS NOT NULL;
