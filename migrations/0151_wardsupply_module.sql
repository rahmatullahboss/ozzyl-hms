-- WardSupply Module Migration
-- Enables ward-level supply requisition from central inventory

-- ─── Requisitions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ward_supply_requisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  requisition_no TEXT NOT NULL,
  ward_id INTEGER NOT NULL,
  ward_name TEXT,
  patient_id INTEGER,
  requested_by TEXT NOT NULL,
  requested_by_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'partially_dispatched', 'fully_dispatched', 'rejected', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine', 'urgent', 'emergency')),
  remarks TEXT,
  approved_by TEXT,
  approved_by_id INTEGER,
  approved_at TEXT,
  approval_remarks TEXT,
  total_items INTEGER NOT NULL DEFAULT 0,
  total_value REAL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wsr_tenant ON ward_supply_requisitions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_wsr_ward ON ward_supply_requisitions(tenant_id, ward_id);
CREATE INDEX IF NOT EXISTS idx_wsr_status ON ward_supply_requisitions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_wsr_patient ON ward_supply_requisitions(tenant_id, patient_id);

-- ─── Requisition Items ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ward_supply_requisition_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  requisition_id INTEGER NOT NULL,
  inventory_item_id INTEGER,
  item_name TEXT NOT NULL,
  item_code TEXT,
  specification TEXT,
  quantity_requested INTEGER NOT NULL,
  quantity_approved INTEGER DEFAULT 0,
  quantity_dispatched INTEGER DEFAULT 0,
  quantity_received INTEGER DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'pcs',
  unit_price REAL,
  line_total REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'partially_dispatched', 'fully_dispatched', 'rejected')),
  remarks TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wsri_requisition ON ward_supply_requisition_items(tenant_id, requisition_id);
CREATE INDEX IF NOT EXISTS idx_wsri_item ON ward_supply_requisition_items(tenant_id, inventory_item_id);

-- ─── Dispatches ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ward_supply_dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  dispatch_no TEXT NOT NULL,
  requisition_id INTEGER NOT NULL,
  ward_id INTEGER NOT NULL,
  dispatched_by TEXT NOT NULL,
  dispatched_by_id INTEGER,
  dispatched_at TEXT DEFAULT CURRENT_TIMESTAMP,
  received_by TEXT,
  received_by_id INTEGER,
  received_at TEXT,
  receipt_remarks TEXT,
  status TEXT NOT NULL DEFAULT 'dispatched' CHECK (status IN ('dispatched', 'partially_received', 'fully_received')),
  total_items INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wsd_tenant ON ward_supply_dispatches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_wsd_requisition ON ward_supply_dispatches(tenant_id, requisition_id);
CREATE INDEX IF NOT EXISTS idx_wsd_ward ON ward_supply_dispatches(tenant_id, ward_id);

-- ─── Dispatch Items ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ward_supply_dispatch_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  dispatch_id INTEGER NOT NULL,
  requisition_item_id INTEGER NOT NULL,
  inventory_item_id INTEGER,
  item_name TEXT NOT NULL,
  quantity_dispatched INTEGER NOT NULL,
  quantity_received INTEGER DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'pcs',
  batch_no TEXT,
  expiry_date TEXT,
  unit_price REAL,
  line_total REAL,
  remarks TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wsdi_dispatch ON ward_supply_dispatch_items(tenant_id, dispatch_id);

-- ─── Ward Stock (consumption tracking) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ward_supply_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  ward_id INTEGER NOT NULL,
  inventory_item_id INTEGER,
  item_name TEXT NOT NULL,
  item_code TEXT,
  unit TEXT NOT NULL DEFAULT 'pcs',
  current_quantity INTEGER NOT NULL DEFAULT 0,
  min_stock_level INTEGER NOT NULL DEFAULT 0,
  max_stock_level INTEGER,
  last_receipt_date TEXT,
  last_consumption_date TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wss_tenant_ward ON ward_supply_stock(tenant_id, ward_id);
CREATE INDEX IF NOT EXISTS idx_wss_item ON ward_supply_stock(tenant_id, inventory_item_id);

-- ─── Ward Stock Transactions ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ward_supply_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  ward_id INTEGER NOT NULL,
  inventory_item_id INTEGER,
  item_name TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('receipt', 'consumption', 'return', 'adjustment')),
  quantity INTEGER NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  performed_by TEXT,
  performed_by_id INTEGER,
  remarks TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wst_tenant_ward ON ward_supply_transactions(tenant_id, ward_id);
CREATE INDEX IF NOT EXISTS idx_wst_item ON ward_supply_transactions(tenant_id, inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_wst_type ON ward_supply_transactions(tenant_id, transaction_type);

-- ─── Trigger: Update ward stock on receipt ────────────────────────────────────

CREATE TRIGGER IF NOT EXISTS trg_ward_stock_receipt
AFTER INSERT ON ward_supply_transactions
WHEN NEW.transaction_type = 'receipt'
BEGIN
  INSERT INTO ward_supply_stock (tenant_id, ward_id, inventory_item_id, item_name, current_quantity, last_receipt_date, updated_at)
  VALUES (NEW.tenant_id, NEW.ward_id, NEW.inventory_item_id, NEW.item_name, NEW.quantity, NEW.created_at, NEW.created_at)
  ON CONFLICT(tenant_id, ward_id, inventory_item_id) DO UPDATE SET
    current_quantity = current_quantity + NEW.quantity,
    last_receipt_date = NEW.created_at,
    updated_at = NEW.created_at;
END;

CREATE TRIGGER IF NOT EXISTS trg_ward_stock_consumption
AFTER INSERT ON ward_supply_transactions
WHEN NEW.transaction_type = 'consumption'
BEGIN
  UPDATE ward_supply_stock SET
    current_quantity = MAX(0, current_quantity - NEW.quantity),
    last_consumption_date = NEW.created_at,
    updated_at = NEW.created_at
  WHERE tenant_id = NEW.tenant_id AND ward_id = NEW.ward_id AND (inventory_item_id = NEW.inventory_item_id OR (inventory_item_id IS NULL AND item_name = NEW.item_name));
END;
