-- Inventory production-grade extension
-- Adds Danphe-style traceability, ward/room stock, QR scan registry, purchase requests,
-- fixed-asset movement/disposal/depreciation, and auditable lifecycle state.

-- ─── Location Master ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS InventoryLocation (
  LocationId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  LocationCode TEXT NOT NULL,
  LocationName TEXT NOT NULL,
  LocationType TEXT NOT NULL DEFAULT 'room' CHECK(LocationType IN ('hospital','building','floor','ward','room','bed','store','rack','department','other')),
  ParentLocationId INTEGER REFERENCES InventoryLocation(LocationId),
  StoreId INTEGER REFERENCES InventoryStore(StoreId),
  WardId INTEGER,
  WardName TEXT,
  RoomNo TEXT,
  BedId INTEGER,
  Floor TEXT,
  Department TEXT,
  IsActive INTEGER NOT NULL DEFAULT 1,
  CreatedBy INTEGER,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ModifiedBy INTEGER,
  ModifiedOn TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_location_code ON InventoryLocation(tenant_id, LocationCode);
CREATE INDEX IF NOT EXISTS idx_inv_location_parent ON InventoryLocation(tenant_id, ParentLocationId);
CREATE INDEX IF NOT EXISTS idx_inv_location_ward ON InventoryLocation(tenant_id, WardId);
CREATE INDEX IF NOT EXISTS idx_inv_location_store ON InventoryLocation(tenant_id, StoreId);

-- ─── QR / Barcode Registry ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS InventoryQrTag (
  QrTagId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  TagCode TEXT NOT NULL,
  EntityType TEXT NOT NULL CHECK(EntityType IN ('item','stock','store','location','ward_stock','fixed_asset','purchase_order','goods_receipt')),
  EntityId INTEGER NOT NULL,
  HumanLabel TEXT,
  PayloadJson TEXT NOT NULL,
  Status TEXT NOT NULL DEFAULT 'active' CHECK(Status IN ('active','retired','lost','damaged')),
  PrintCount INTEGER NOT NULL DEFAULT 0,
  LastPrintedOn TEXT,
  LastScannedOn TEXT,
  CreatedBy INTEGER,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ModifiedBy INTEGER,
  ModifiedOn TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_qr_code ON InventoryQrTag(tenant_id, TagCode);
CREATE INDEX IF NOT EXISTS idx_inv_qr_entity ON InventoryQrTag(tenant_id, EntityType, EntityId);

CREATE TABLE IF NOT EXISTS InventoryQrScanLog (
  ScanId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  TagCode TEXT NOT NULL,
  EntityType TEXT,
  EntityId INTEGER,
  ScanPurpose TEXT DEFAULT 'lookup',
  ScanSource TEXT,
  LocationId INTEGER,
  WardId INTEGER,
  ScannedBy INTEGER,
  ScanResult TEXT NOT NULL DEFAULT 'found' CHECK(ScanResult IN ('found','not_found','inactive','error')),
  ResultJson TEXT,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inv_scan_code ON InventoryQrScanLog(tenant_id, TagCode);
CREATE INDEX IF NOT EXISTS idx_inv_scan_date ON InventoryQrScanLog(tenant_id, CreatedOn);

-- ─── Ward / Room / Location Stock ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ward_supply_location_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  ward_id INTEGER NOT NULL,
  location_id INTEGER REFERENCES InventoryLocation(LocationId),
  room_no TEXT,
  bed_id INTEGER,
  inventory_item_id INTEGER,
  stock_id INTEGER,
  fixed_asset_stock_id INTEGER,
  item_name TEXT NOT NULL,
  item_code TEXT,
  unit TEXT NOT NULL DEFAULT 'pcs',
  current_quantity INTEGER NOT NULL DEFAULT 0,
  min_stock_level INTEGER NOT NULL DEFAULT 0,
  max_stock_level INTEGER,
  is_fixed_asset INTEGER NOT NULL DEFAULT 0,
  tag_code TEXT,
  last_receipt_date TEXT,
  last_consumption_date TEXT,
  last_audit_date TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wsl_unique_consumable
  ON ward_supply_location_stock(tenant_id, ward_id, IFNULL(location_id, 0), IFNULL(inventory_item_id, 0), IFNULL(stock_id, 0), IFNULL(fixed_asset_stock_id, 0));
CREATE INDEX IF NOT EXISTS idx_wsl_ward ON ward_supply_location_stock(tenant_id, ward_id);
CREATE INDEX IF NOT EXISTS idx_wsl_location ON ward_supply_location_stock(tenant_id, location_id);
CREATE INDEX IF NOT EXISTS idx_wsl_tag ON ward_supply_location_stock(tenant_id, tag_code);

CREATE TABLE IF NOT EXISTS ward_supply_location_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  ward_id INTEGER NOT NULL,
  location_id INTEGER,
  stock_location_id INTEGER,
  inventory_item_id INTEGER,
  stock_id INTEGER,
  fixed_asset_stock_id INTEGER,
  item_name TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK(transaction_type IN ('receipt','consumption','return','adjustment','move','audit')),
  quantity INTEGER NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  from_location_id INTEGER,
  to_location_id INTEGER,
  patient_id INTEGER,
  performed_by TEXT,
  performed_by_id INTEGER,
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wslt_ward ON ward_supply_location_transactions(tenant_id, ward_id);
CREATE INDEX IF NOT EXISTS idx_wslt_location ON ward_supply_location_transactions(tenant_id, location_id);
CREATE INDEX IF NOT EXISTS idx_wslt_item ON ward_supply_location_transactions(tenant_id, inventory_item_id);

-- ─── Purchase Requests ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS InventoryPurchaseRequest (
  PurchaseRequestId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PRNumber TEXT NOT NULL,
  PRDate TEXT NOT NULL,
  RequestingStoreId INTEGER REFERENCES InventoryStore(StoreId),
  DepartmentId INTEGER,
  Department TEXT,
  RequestedBy INTEGER,
  Priority TEXT NOT NULL DEFAULT 'normal' CHECK(Priority IN ('low','normal','high','urgent')),
  RequiredDate TEXT,
  Status TEXT NOT NULL DEFAULT 'draft' CHECK(Status IN ('draft','submitted','approved','rejected','converted','cancelled')),
  ApprovedBy INTEGER,
  ApprovedOn TEXT,
  ApprovalRemarks TEXT,
  Remarks TEXT,
  CreatedBy INTEGER,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ModifiedBy INTEGER,
  ModifiedOn TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_pr_no ON InventoryPurchaseRequest(tenant_id, PRNumber);
CREATE INDEX IF NOT EXISTS idx_inv_pr_status ON InventoryPurchaseRequest(tenant_id, Status);
CREATE INDEX IF NOT EXISTS idx_inv_pr_store ON InventoryPurchaseRequest(tenant_id, RequestingStoreId);

CREATE TABLE IF NOT EXISTS InventoryPurchaseRequestItem (
  PurchaseRequestItemId INTEGER PRIMARY KEY AUTOINCREMENT,
  PurchaseRequestId INTEGER NOT NULL REFERENCES InventoryPurchaseRequest(PurchaseRequestId),
  ItemId INTEGER REFERENCES InventoryItem(ItemId),
  ItemName TEXT,
  Quantity INTEGER NOT NULL,
  ApprovedQuantity INTEGER DEFAULT 0,
  EstimatedRate REAL DEFAULT 0,
  EstimatedAmount REAL DEFAULT 0,
  Remarks TEXT,
  CreatedBy INTEGER,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inv_pr_item_pr ON InventoryPurchaseRequestItem(PurchaseRequestId);

-- ─── Asset Lifecycle ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_movement_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  asset_stock_id INTEGER NOT NULL,
  movement_type TEXT NOT NULL CHECK(movement_type IN ('register','allocate','transfer','return','maintenance','status_change','audit','dispose','depreciation')),
  from_department TEXT,
  from_location TEXT,
  to_department TEXT,
  to_location TEXT,
  condition_before TEXT,
  condition_after TEXT,
  value_before REAL,
  value_after REAL,
  reference_type TEXT,
  reference_id INTEGER,
  performed_by INTEGER,
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_asset_move_tenant ON asset_movement_log(tenant_id, asset_stock_id);
CREATE INDEX IF NOT EXISTS idx_asset_move_type ON asset_movement_log(tenant_id, movement_type);

CREATE TABLE IF NOT EXISTS asset_depreciation_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  asset_stock_id INTEGER NOT NULL,
  depreciation_method TEXT NOT NULL DEFAULT 'straight_line' CHECK(depreciation_method IN ('straight_line','declining_balance','manual')),
  fiscal_year TEXT,
  depreciation_date TEXT NOT NULL,
  opening_value REAL NOT NULL DEFAULT 0,
  depreciation_rate REAL DEFAULT 0,
  depreciation_amount REAL NOT NULL DEFAULT 0,
  closing_value REAL NOT NULL DEFAULT 0,
  remarks TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_asset_depr_asset ON asset_depreciation_entries(tenant_id, asset_stock_id);

CREATE TABLE IF NOT EXISTS asset_disposal_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  asset_stock_id INTEGER NOT NULL,
  disposal_date TEXT NOT NULL,
  disposal_type TEXT NOT NULL CHECK(disposal_type IN ('scrap','sold','lost','donated','condemned')),
  reason TEXT NOT NULL,
  disposal_value REAL DEFAULT 0,
  approved_by INTEGER,
  approved_on TEXT,
  remarks TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_asset_disposal_asset ON asset_disposal_records(tenant_id, asset_stock_id);

CREATE TABLE IF NOT EXISTS InventoryApprovalLog (
  ApprovalLogId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  EntityType TEXT NOT NULL,
  EntityId INTEGER NOT NULL,
  Action TEXT NOT NULL,
  FromStatus TEXT,
  ToStatus TEXT,
  Remarks TEXT,
  PerformedBy INTEGER,
  PerformedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inv_approval_entity ON InventoryApprovalLog(tenant_id, EntityType, EntityId);

-- Existing asset_allocations from 0080 has created_at but no updated_at; lifecycle
-- return workflows need an explicit mutable timestamp.
ALTER TABLE asset_allocations ADD COLUMN updated_at TEXT;

ALTER TABLE ward_supply_requisitions ADD COLUMN source_store_id INTEGER;
ALTER TABLE ward_supply_requisitions ADD COLUMN location_id INTEGER;
ALTER TABLE ward_supply_requisitions ADD COLUMN room_no TEXT;
ALTER TABLE ward_supply_requisition_items ADD COLUMN stock_id INTEGER;
ALTER TABLE ward_supply_dispatches ADD COLUMN source_store_id INTEGER;
ALTER TABLE ward_supply_dispatches ADD COLUMN location_id INTEGER;
ALTER TABLE ward_supply_dispatches ADD COLUMN room_no TEXT;
ALTER TABLE ward_supply_dispatch_items ADD COLUMN stock_id INTEGER;
ALTER TABLE ward_supply_dispatch_items ADD COLUMN source_store_id INTEGER;
ALTER TABLE ward_supply_dispatch_items ADD COLUMN location_id INTEGER;
ALTER TABLE ward_supply_dispatch_items ADD COLUMN room_no TEXT;
ALTER TABLE ward_supply_transactions ADD COLUMN location_id INTEGER;
ALTER TABLE ward_supply_transactions ADD COLUMN room_no TEXT;
ALTER TABLE ward_supply_transactions ADD COLUMN stock_id INTEGER;
