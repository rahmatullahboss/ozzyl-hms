-- Migration: 0375_lab_consumable_stock_locations.sql
-- Purpose: Track lab consumable stock by physical storage/use location.

CREATE TABLE IF NOT EXISTS lab_consumable_locations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  location_code TEXT    NOT NULL,
  location_name TEXT    NOT NULL,
  location_type TEXT    NOT NULL DEFAULT 'store' CHECK(location_type IN ('store','fridge','analyzer','rack','room','other')),
  description   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  tenant_id     INTEGER NOT NULL,
  created_by    INTEGER,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_consumable_locations_code
  ON lab_consumable_locations(tenant_id, location_code);

ALTER TABLE lab_consumable_stock ADD COLUMN location_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_lab_consumable_stock_location
  ON lab_consumable_stock(tenant_id, location_id, quantity_available);
