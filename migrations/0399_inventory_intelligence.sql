-- Inventory Intelligence Layer
-- Date: 2026-07-05

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS inventory_consumption_rule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  rule_scope TEXT NOT NULL,
  reference_id INTEGER,
  reference_code TEXT,
  reference_name TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'tenant',
  confidence TEXT NOT NULL DEFAULT 'starter',
  notes TEXT,
  effective_from DATETIME DEFAULT CURRENT_TIMESTAMP,
  effective_to DATETIME,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_consumption_rule_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  rule_id INTEGER NOT NULL REFERENCES inventory_consumption_rule(id),
  inventory_item_id INTEGER,
  lab_consumable_id INTEGER,
  item_name TEXT NOT NULL,
  quantity_per_event REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'test',
  is_mandatory INTEGER NOT NULL DEFAULT 1,
  allow_substitute INTEGER NOT NULL DEFAULT 0,
  deduction_mode TEXT NOT NULL DEFAULT 'auto',
  calibration_status TEXT NOT NULL DEFAULT 'needs_review',
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_demand_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  inventory_item_id INTEGER NOT NULL,
  demand_date DATE NOT NULL,
  source_scope TEXT NOT NULL,
  consumed_qty REAL NOT NULL DEFAULT 0,
  billed_event_count INTEGER NOT NULL DEFAULT 0,
  completed_event_count INTEGER NOT NULL DEFAULT 0,
  waste_qty REAL NOT NULL DEFAULT 0,
  adjustment_qty REAL NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, inventory_item_id, demand_date, source_scope)
);

CREATE TABLE IF NOT EXISTS inventory_stock_intelligence_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  inventory_item_id INTEGER NOT NULL,
  usable_stock REAL NOT NULL DEFAULT 0,
  blocked_stock REAL NOT NULL DEFAULT 0,
  current_stock REAL NOT NULL DEFAULT 0,
  avg_daily_usage_7d REAL NOT NULL DEFAULT 0,
  avg_daily_usage_30d REAL NOT NULL DEFAULT 0,
  avg_daily_usage_90d REAL NOT NULL DEFAULT 0,
  trend_label TEXT NOT NULL DEFAULT 'stable',
  lead_time_days INTEGER NOT NULL DEFAULT 7,
  safety_stock_days INTEGER NOT NULL DEFAULT 7,
  reorder_point REAL NOT NULL DEFAULT 0,
  suggested_order_qty REAL NOT NULL DEFAULT 0,
  days_of_cover REAL,
  estimated_stockout_date DATE,
  open_pr_qty REAL NOT NULL DEFAULT 0,
  open_po_qty REAL NOT NULL DEFAULT 0,
  recommendation_status TEXT NOT NULL DEFAULT 'ok',
  computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, inventory_item_id)
);

CREATE TABLE IF NOT EXISTS inventory_recommendation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  recommendation_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  inventory_item_id INTEGER,
  rule_id INTEGER,
  reference_type TEXT,
  reference_id INTEGER,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  suggested_action TEXT NOT NULL,
  suggested_quantity REAL,
  metadata_json TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_rule_scope_ref ON inventory_consumption_rule(tenant_id, rule_scope, reference_id, status);
CREATE INDEX IF NOT EXISTS idx_inv_rule_item_rule ON inventory_consumption_rule_item(tenant_id, rule_id);
CREATE INDEX IF NOT EXISTS idx_inv_demand_item_date ON inventory_demand_daily(tenant_id, inventory_item_id, demand_date);
CREATE INDEX IF NOT EXISTS idx_inv_intel_status ON inventory_stock_intelligence_snapshot(tenant_id, recommendation_status);
CREATE INDEX IF NOT EXISTS idx_inv_recommendation_status ON inventory_recommendation(tenant_id, status, severity, created_at);
