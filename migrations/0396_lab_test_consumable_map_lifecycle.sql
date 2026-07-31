-- Migration: 0396_lab_test_consumable_map_lifecycle.sql

-- Purpose: Keep lab test-to-reagent mapping audit-safe while allowing mappings to be removed and later reactivated.

ALTER TABLE lab_test_consumable_map ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE lab_test_consumable_map ADD COLUMN effective_from DATETIME;
ALTER TABLE lab_test_consumable_map ADD COLUMN effective_to DATETIME;
ALTER TABLE lab_test_consumable_map ADD COLUMN deleted_at DATETIME;
ALTER TABLE lab_test_consumable_map ADD COLUMN deleted_by TEXT;
ALTER TABLE lab_test_consumable_map ADD COLUMN updated_at DATETIME;

UPDATE lab_test_consumable_map
SET effective_from = COALESCE(effective_from, CURRENT_TIMESTAMP),
    updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP);

CREATE INDEX IF NOT EXISTS idx_lab_test_cons_map_active
  ON lab_test_consumable_map(tenant_id, lab_test_id, is_active, effective_from, effective_to);

CREATE INDEX IF NOT EXISTS idx_lab_test_cons_map_deleted
  ON lab_test_consumable_map(tenant_id, deleted_at);
