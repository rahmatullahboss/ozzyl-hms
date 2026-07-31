-- Migration 0400: Opening stock lot-level traceability
-- Adds explicit LotNumber support for hospital-grade opening stock imports while preserving existing BatchNo workflows.

ALTER TABLE InventoryStock ADD COLUMN LotNumber TEXT;

CREATE INDEX IF NOT EXISTS idx_inv_stock_lot
  ON InventoryStock(tenant_id, LotNumber);

CREATE INDEX IF NOT EXISTS idx_inv_stock_lot_batch_expiry
  ON InventoryStock(tenant_id, ItemId, StoreId, LotNumber, BatchNo, ExpiryDate);
