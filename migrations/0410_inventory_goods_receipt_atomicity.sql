-- Goods receipt request atomicity, replay safety and PO over-receipt guard.

ALTER TABLE InventoryGoodsReceipt ADD COLUMN OperationKey TEXT;
ALTER TABLE InventoryGoodsReceipt ADD COLUMN RequestHash TEXT;
ALTER TABLE InventoryGoodsReceipt ADD COLUMN OperationStatus TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE InventoryGoodsReceiptItem ADD COLUMN OperationLineKey TEXT;
ALTER TABLE InventoryStock ADD COLUMN ReceiptOperationLineKey TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_gr_operation_key
  ON InventoryGoodsReceipt(tenant_id, OperationKey)
  WHERE OperationKey IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_gr_operation_status
  ON InventoryGoodsReceipt(tenant_id, OperationStatus, CreatedOn);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_gr_item_operation_line
  ON InventoryGoodsReceiptItem(GoodsReceiptId, OperationLineKey)
  WHERE OperationLineKey IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_stock_receipt_line
  ON InventoryStock(tenant_id, ReceiptOperationLineKey)
  WHERE ReceiptOperationLineKey IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_gr_batch_guard (
  tenant_id TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  assertion_value INTEGER NOT NULL CHECK(assertion_value = 1),
  PRIMARY KEY(tenant_id, operation_key, item_id)
);
