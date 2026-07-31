-- Bed equipment mapping for Bed Command Center
-- Tracks bedside equipment and readiness per bed/cabin.

CREATE TABLE IF NOT EXISTS bed_equipment_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  bed_id INTEGER NOT NULL,
  fixed_asset_stock_id INTEGER,
  equipment_name TEXT NOT NULL,
  required_qty INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'in_use', 'faulty', 'maintenance', 'missing')),
  last_checked_at TEXT,
  checked_by TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bed_equipment_map_bed ON bed_equipment_map(tenant_id, bed_id, is_active);
CREATE INDEX IF NOT EXISTS idx_bed_equipment_map_asset ON bed_equipment_map(tenant_id, fixed_asset_stock_id);
CREATE INDEX IF NOT EXISTS idx_bed_equipment_map_status ON bed_equipment_map(tenant_id, status);
