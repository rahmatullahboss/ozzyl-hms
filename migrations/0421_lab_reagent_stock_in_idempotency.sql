-- Migration: 0421_lab_reagent_stock_in_idempotency.sql
-- Purpose: prevent duplicate canonical reagent stock lots when stock-in or legacy backfill is retried.

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_stock_tx_lab_idempotency
  ON InventoryStockTransaction(tenant_id, TransactionType, ReferenceNo)
  WHERE TransactionType IN ('lab-stock-in', 'lab-legacy-backfill')
    AND ReferenceNo IS NOT NULL;
