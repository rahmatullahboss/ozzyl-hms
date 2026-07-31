-- Durable, retry-safe lab item cancellation orchestration.

CREATE TABLE IF NOT EXISTS lab_cancellation_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  lab_order_item_id INTEGER NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK(status IN ('processing', 'core_completed', 'completed', 'failed')),
  skip_invoice_update INTEGER NOT NULL DEFAULT 0,
  bill_id INTEGER,
  lab_order_id INTEGER NOT NULL,
  cancelled_amount REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  notes TEXT,
  last_error TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  UNIQUE(tenant_id, lab_order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_lab_cancellation_operation_status
  ON lab_cancellation_operations(tenant_id, status, updated_at);
