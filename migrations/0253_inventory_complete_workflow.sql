-- Migration 0253: Complete hospital inventory workflow extensions.
-- Additive only: preserves existing Danphe-style inventory/pharmacy/accounting tables.

-- Item master enrichment
ALTER TABLE InventoryItem ADD COLUMN ItemType TEXT DEFAULT 'general';
ALTER TABLE InventoryItem ADD COLUMN GenericName TEXT;
ALTER TABLE InventoryItem ADD COLUMN BrandName TEXT;
ALTER TABLE InventoryItem ADD COLUMN ManufacturerName TEXT;
ALTER TABLE InventoryItem ADD COLUMN Strength TEXT;
ALTER TABLE InventoryItem ADD COLUMN DosageForm TEXT;
ALTER TABLE InventoryItem ADD COLUMN PurchaseUnit TEXT;
ALTER TABLE InventoryItem ADD COLUMN IssueUnit TEXT;
ALTER TABLE InventoryItem ADD COLUMN UnitConversionFactor REAL DEFAULT 1;
ALTER TABLE InventoryItem ADD COLUMN SupplierId INTEGER;
ALTER TABLE InventoryItem ADD COLUMN Barcode TEXT;
ALTER TABLE InventoryItem ADD COLUMN IsBatchRequired INTEGER DEFAULT 0;
ALTER TABLE InventoryItem ADD COLUMN IsExpiryRequired INTEGER DEFAULT 0;
ALTER TABLE InventoryItem ADD COLUMN IsSerialRequired INTEGER DEFAULT 0;
ALTER TABLE InventoryItem ADD COLUMN MaxStockQuantity INTEGER DEFAULT 0;
ALTER TABLE InventoryItem ADD COLUMN PurchasePrice REAL DEFAULT 0;
ALTER TABLE InventoryItem ADD COLUMN SalePrice REAL DEFAULT 0;
ALTER TABLE InventoryItem ADD COLUMN StorageCondition TEXT;
ALTER TABLE InventoryItem ADD COLUMN RackShelf TEXT;
ALTER TABLE InventoryItem ADD COLUMN Chargeable INTEGER DEFAULT 0;
ALTER TABLE InventoryItem ADD COLUMN BillingServiceItemId INTEGER;
ALTER TABLE InventoryItem ADD COLUMN MedicineMetaJson TEXT;
ALTER TABLE InventoryItem ADD COLUMN LabMetaJson TEXT;
ALTER TABLE InventoryItem ADD COLUMN AssetMetaJson TEXT;

CREATE INDEX IF NOT EXISTS idx_inv_item_type ON InventoryItem(tenant_id, ItemType);
CREATE INDEX IF NOT EXISTS idx_inv_item_barcode ON InventoryItem(tenant_id, Barcode);
CREATE INDEX IF NOT EXISTS idx_inv_item_supplier ON InventoryItem(tenant_id, SupplierId);

-- Batch/location stock enrichment
ALTER TABLE InventoryStock ADD COLUMN ReservedQuantity INTEGER DEFAULT 0;
ALTER TABLE InventoryStock ADD COLUMN DamagedQuantity INTEGER DEFAULT 0;
ALTER TABLE InventoryStock ADD COLUMN BlockedQuantity INTEGER DEFAULT 0;
ALTER TABLE InventoryStock ADD COLUMN InTransitQuantity INTEGER DEFAULT 0;
ALTER TABLE InventoryStock ADD COLUMN RackShelf TEXT;
ALTER TABLE InventoryStock ADD COLUMN QCStatus TEXT DEFAULT 'accepted';
ALTER TABLE InventoryStock ADD COLUMN ManufactureDate TEXT;
ALTER TABLE InventoryStock ADD COLUMN OpenDate TEXT;
ALTER TABLE InventoryStock ADD COLUMN AfterOpenExpiryDate TEXT;
ALTER TABLE InventoryStock ADD COLUMN StorageTemperature TEXT;
ALTER TABLE InventoryStock ADD COLUMN StockStatus TEXT DEFAULT 'available';

CREATE INDEX IF NOT EXISTS idx_inv_stock_status ON InventoryStock(tenant_id, StockStatus);
CREATE INDEX IF NOT EXISTS idx_inv_stock_store_status ON InventoryStock(tenant_id, StoreId, StockStatus);
CREATE INDEX IF NOT EXISTS idx_inv_stock_expiry_store ON InventoryStock(tenant_id, StoreId, ExpiryDate);

-- Patient/department/lab/OT consumption
CREATE TABLE IF NOT EXISTS InventoryConsumption (
  ConsumptionId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  ConsumptionNo TEXT NOT NULL,
  ConsumptionDate TEXT NOT NULL,
  IssueType TEXT NOT NULL DEFAULT 'department_issue',
  FromStoreId INTEGER REFERENCES InventoryStore(StoreId),
  DepartmentId INTEGER,
  Department TEXT,
  PatientId INTEGER,
  AdmissionId INTEGER,
  VisitId INTEGER,
  SurgeryId INTEGER,
  LabOrderId INTEGER,
  Chargeable INTEGER NOT NULL DEFAULT 0,
  BillingStatus TEXT NOT NULL DEFAULT 'not_chargeable',
  BillingReferenceId INTEGER,
  TotalCost REAL NOT NULL DEFAULT 0,
  TotalCharge REAL NOT NULL DEFAULT 0,
  Remarks TEXT,
  CreatedBy INTEGER,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_cons_no ON InventoryConsumption(tenant_id, ConsumptionNo);
CREATE INDEX IF NOT EXISTS idx_inv_cons_patient ON InventoryConsumption(tenant_id, PatientId, ConsumptionDate);
CREATE INDEX IF NOT EXISTS idx_inv_cons_department ON InventoryConsumption(tenant_id, Department, ConsumptionDate);
CREATE INDEX IF NOT EXISTS idx_inv_cons_type ON InventoryConsumption(tenant_id, IssueType, ConsumptionDate);

CREATE TABLE IF NOT EXISTS InventoryConsumptionItem (
  ConsumptionItemId INTEGER PRIMARY KEY AUTOINCREMENT,
  ConsumptionId INTEGER NOT NULL REFERENCES InventoryConsumption(ConsumptionId),
  ItemId INTEGER REFERENCES InventoryItem(ItemId),
  StockId INTEGER REFERENCES InventoryStock(StockId),
  BatchNo TEXT,
  ExpiryDate TEXT,
  Quantity INTEGER NOT NULL,
  Unit TEXT,
  CostPrice REAL NOT NULL DEFAULT 0,
  ChargeAmount REAL NOT NULL DEFAULT 0,
  IsChargeable INTEGER NOT NULL DEFAULT 0,
  BillingReferenceId INTEGER,
  Remarks TEXT,
  CreatedBy INTEGER,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inv_cons_item_cons ON InventoryConsumptionItem(ConsumptionId);
CREATE INDEX IF NOT EXISTS idx_inv_cons_item_stock ON InventoryConsumptionItem(StockId);

-- Explicit store transfer with in-transit state
CREATE TABLE IF NOT EXISTS InventoryTransfer (
  TransferId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  TransferNo TEXT NOT NULL,
  TransferDate TEXT NOT NULL,
  FromStoreId INTEGER NOT NULL REFERENCES InventoryStore(StoreId),
  ToStoreId INTEGER NOT NULL REFERENCES InventoryStore(StoreId),
  Status TEXT NOT NULL DEFAULT 'draft' CHECK(Status IN ('draft','in_transit','received','partially_received','cancelled')),
  SentBy INTEGER,
  SentOn TEXT,
  ReceivedBy INTEGER,
  ReceivedOn TEXT,
  Remarks TEXT,
  CreatedBy INTEGER,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_transfer_no ON InventoryTransfer(tenant_id, TransferNo);
CREATE INDEX IF NOT EXISTS idx_inv_transfer_status ON InventoryTransfer(tenant_id, Status);

CREATE TABLE IF NOT EXISTS InventoryTransferItem (
  TransferItemId INTEGER PRIMARY KEY AUTOINCREMENT,
  TransferId INTEGER NOT NULL REFERENCES InventoryTransfer(TransferId),
  ItemId INTEGER REFERENCES InventoryItem(ItemId),
  StockId INTEGER REFERENCES InventoryStock(StockId),
  BatchNo TEXT,
  ExpiryDate TEXT,
  Quantity INTEGER NOT NULL,
  ReceivedQuantity INTEGER NOT NULL DEFAULT 0,
  CostPrice REAL DEFAULT 0,
  Remarks TEXT,
  CreatedBy INTEGER,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inv_transfer_item_transfer ON InventoryTransferItem(TransferId);

-- Department/patient returns
CREATE TABLE IF NOT EXISTS InventoryDepartmentReturn (
  ReturnId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  ReturnNo TEXT NOT NULL,
  ReturnDate TEXT NOT NULL,
  ReturnType TEXT NOT NULL DEFAULT 'department_return' CHECK(ReturnType IN ('department_return','patient_return','supplier_return')),
  FromDepartment TEXT,
  PatientId INTEGER,
  ToStoreId INTEGER REFERENCES InventoryStore(StoreId),
  Reason TEXT,
  BillingAdjustmentStatus TEXT DEFAULT 'not_applicable',
  Remarks TEXT,
  CreatedBy INTEGER,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_dept_return_no ON InventoryDepartmentReturn(tenant_id, ReturnNo);

CREATE TABLE IF NOT EXISTS InventoryDepartmentReturnItem (
  ReturnItemId INTEGER PRIMARY KEY AUTOINCREMENT,
  ReturnId INTEGER NOT NULL REFERENCES InventoryDepartmentReturn(ReturnId),
  ItemId INTEGER REFERENCES InventoryItem(ItemId),
  StockId INTEGER REFERENCES InventoryStock(StockId),
  BatchNo TEXT,
  Quantity INTEGER NOT NULL,
  IsBillAdjusted INTEGER NOT NULL DEFAULT 0,
  Remarks TEXT,
  CreatedBy INTEGER,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inv_dept_return_item ON InventoryDepartmentReturnItem(ReturnId);

-- Stock count and variance approval
CREATE TABLE IF NOT EXISTS InventoryStockCountSession (
  CountSessionId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  CountNo TEXT NOT NULL,
  StoreId INTEGER REFERENCES InventoryStore(StoreId),
  CategoryId INTEGER,
  CountDate TEXT NOT NULL,
  AssignedTo INTEGER,
  Status TEXT NOT NULL DEFAULT 'draft' CHECK(Status IN ('draft','in_progress','submitted','approved','cancelled')),
  ApprovedBy INTEGER,
  ApprovedOn TEXT,
  Remarks TEXT,
  CreatedBy INTEGER,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_count_no ON InventoryStockCountSession(tenant_id, CountNo);
CREATE INDEX IF NOT EXISTS idx_inv_count_status ON InventoryStockCountSession(tenant_id, Status);

CREATE TABLE IF NOT EXISTS InventoryStockCountItem (
  CountItemId INTEGER PRIMARY KEY AUTOINCREMENT,
  CountSessionId INTEGER NOT NULL REFERENCES InventoryStockCountSession(CountSessionId),
  ItemId INTEGER REFERENCES InventoryItem(ItemId),
  StockId INTEGER REFERENCES InventoryStock(StockId),
  BatchNo TEXT,
  SystemQuantity INTEGER NOT NULL DEFAULT 0,
  CountedQuantity INTEGER NOT NULL DEFAULT 0,
  DifferenceQuantity INTEGER NOT NULL DEFAULT 0,
  Remarks TEXT,
  CountedBy INTEGER,
  CountedOn TEXT,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inv_count_item_session ON InventoryStockCountItem(CountSessionId);

-- Secure stock adjustment approval
CREATE TABLE IF NOT EXISTS InventoryAdjustmentRequest (
  AdjustmentRequestId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  AdjustmentNo TEXT NOT NULL,
  StoreId INTEGER REFERENCES InventoryStore(StoreId),
  Status TEXT NOT NULL DEFAULT 'submitted' CHECK(Status IN ('submitted','approved','rejected','posted','cancelled')),
  Reason TEXT NOT NULL,
  AttachmentKey TEXT,
  Remarks TEXT,
  ApprovedBy INTEGER,
  ApprovedOn TEXT,
  CreatedBy INTEGER,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_adj_req_no ON InventoryAdjustmentRequest(tenant_id, AdjustmentNo);
CREATE INDEX IF NOT EXISTS idx_inv_adj_req_status ON InventoryAdjustmentRequest(tenant_id, Status);

CREATE TABLE IF NOT EXISTS InventoryAdjustmentRequestItem (
  AdjustmentRequestItemId INTEGER PRIMARY KEY AUTOINCREMENT,
  AdjustmentRequestId INTEGER NOT NULL REFERENCES InventoryAdjustmentRequest(AdjustmentRequestId),
  ItemId INTEGER REFERENCES InventoryItem(ItemId),
  StockId INTEGER REFERENCES InventoryStock(StockId),
  BatchNo TEXT,
  CurrentQuantity INTEGER NOT NULL DEFAULT 0,
  NewQuantity INTEGER NOT NULL DEFAULT 0,
  DifferenceQuantity INTEGER NOT NULL DEFAULT 0,
  Remarks TEXT,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inv_adj_req_item ON InventoryAdjustmentRequestItem(AdjustmentRequestId);

-- Dedicated inventory audit log
CREATE TABLE IF NOT EXISTS InventoryAuditLog (
  AuditLogId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  Action TEXT NOT NULL,
  EntityType TEXT NOT NULL,
  EntityId INTEGER,
  ItemId INTEGER,
  StockId INTEGER,
  BatchNo TEXT,
  StoreId INTEGER,
  ReferenceType TEXT,
  ReferenceId INTEGER,
  OldValueJson TEXT,
  NewValueJson TEXT,
  UserId INTEGER,
  IpAddress TEXT,
  DeviceInfo TEXT,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inv_audit_entity ON InventoryAuditLog(tenant_id, EntityType, EntityId);
CREATE INDEX IF NOT EXISTS idx_inv_audit_item ON InventoryAuditLog(tenant_id, ItemId, CreatedOn);
CREATE INDEX IF NOT EXISTS idx_inv_audit_action ON InventoryAuditLog(tenant_id, Action, CreatedOn);
