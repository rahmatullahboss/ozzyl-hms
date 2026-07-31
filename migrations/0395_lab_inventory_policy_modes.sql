-- Migration: 0395_lab_inventory_policy_modes.sql
-- Purpose: Add soft/strict/disabled reagent inventory modes and setup-phase completion controls.

ALTER TABLE lab_inventory_policy ADD COLUMN lab_inventory_mode TEXT NOT NULL DEFAULT 'soft' CHECK(lab_inventory_mode IN ('disabled','soft','strict'));
ALTER TABLE lab_inventory_policy ADD COLUMN allow_result_without_stock INTEGER NOT NULL DEFAULT 1 CHECK(allow_result_without_stock IN (0,1));
ALTER TABLE lab_inventory_policy ADD COLUMN require_test_mapping_for_completion INTEGER NOT NULL DEFAULT 0 CHECK(require_test_mapping_for_completion IN (0,1));

CREATE INDEX IF NOT EXISTS idx_lab_inventory_policy_mode
  ON lab_inventory_policy(tenant_id, lab_inventory_mode);
