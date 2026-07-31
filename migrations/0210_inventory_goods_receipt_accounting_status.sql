-- Migration: 0210_inventory_goods_receipt_accounting_status.sql
-- Purpose: Track whether a goods receipt has already been posted to accounting.
-- Backup note: run a D1 backup/export before applying this migration to production.

ALTER TABLE InventoryGoodsReceipt ADD COLUMN IsActive INTEGER NOT NULL DEFAULT 1;
ALTER TABLE InventoryGoodsReceipt ADD COLUMN IsPostedToAcc INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_inv_gr_posted_to_acc
  ON InventoryGoodsReceipt(tenant_id, IsPostedToAcc, IsActive);
