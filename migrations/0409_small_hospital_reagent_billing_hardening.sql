-- Small-hospital billing-time reagent and inventory hardening.
-- Adds source-linked reversal idempotency and deduplicated open exceptions.

ALTER TABLE lab_consumable_movements ADD COLUMN reverses_movement_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_consumable_return_source_unique
  ON lab_consumable_movements(tenant_id, reverses_movement_id)
  WHERE movement_type = 'return' AND reverses_movement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lab_consumable_usage_reference
  ON lab_consumable_movements(tenant_id, reference_type, reference_id, movement_type, id);

CREATE TABLE IF NOT EXISTS lab_reagent_reversal_guard (
  tenant_id TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  step_key TEXT NOT NULL,
  assertion_value INTEGER NOT NULL CHECK(assertion_value = 1),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, operation_key, step_key)
);

ALTER TABLE lab_inventory_exceptions ADD COLUMN occurrence_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE lab_inventory_exceptions ADD COLUMN last_occurred_at DATETIME;

UPDATE lab_inventory_exceptions
SET last_occurred_at = COALESCE(last_occurred_at, updated_at, created_at, CURRENT_TIMESTAMP);

UPDATE lab_inventory_exceptions AS keep
SET occurrence_count = (
  SELECT COUNT(*)
  FROM lab_inventory_exceptions AS duplicate
  WHERE duplicate.status = 'open'
    AND duplicate.tenant_id = keep.tenant_id
    AND duplicate.source_event = keep.source_event
    AND COALESCE(duplicate.lab_order_item_id, -1) = COALESCE(keep.lab_order_item_id, -1)
    AND COALESCE(duplicate.consumable_id, -1) = COALESCE(keep.consumable_id, -1)
    AND duplicate.reason = keep.reason
)
WHERE keep.status = 'open'
  AND keep.id = (
    SELECT MAX(candidate.id)
    FROM lab_inventory_exceptions AS candidate
    WHERE candidate.status = 'open'
      AND candidate.tenant_id = keep.tenant_id
      AND candidate.source_event = keep.source_event
      AND COALESCE(candidate.lab_order_item_id, -1) = COALESCE(keep.lab_order_item_id, -1)
      AND COALESCE(candidate.consumable_id, -1) = COALESCE(keep.consumable_id, -1)
      AND candidate.reason = keep.reason
  );

DELETE FROM lab_inventory_exceptions
WHERE status = 'open'
  AND id NOT IN (
    SELECT MAX(id)
    FROM lab_inventory_exceptions
    WHERE status = 'open'
    GROUP BY tenant_id, source_event, COALESCE(lab_order_item_id, -1), COALESCE(consumable_id, -1), reason
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_inventory_exception_open_unique
  ON lab_inventory_exceptions(
    tenant_id,
    source_event,
    COALESCE(lab_order_item_id, -1),
    COALESCE(consumable_id, -1),
    reason
  )
  WHERE status = 'open';
