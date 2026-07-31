-- Migration: Inventory & Supply Chain Module
-- Description: Complete inventory management - vendors, items, POs, GRN, stock, requisitions, dispatch, write-offs, returns, RFQ/quotations
-- Source: Ported from danphe-next-cloudflare (0015-0019) + tenant_id support

-- ============================================================
-- VENDORS
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryVendor (
    VendorId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    VendorName TEXT NOT NULL,
    VendorCode TEXT,
    ContactPerson TEXT,
    ContactPhone TEXT,
    ContactEmail TEXT,
    ContactAddress TEXT,
    City TEXT,
    Country TEXT,
    PANNo TEXT,
    CreditPeriod INTEGER DEFAULT 30,
    IsActive INTEGER DEFAULT 1,
    IsTDSApplicable INTEGER DEFAULT 0,
    TDSPercent REAL DEFAULT 0,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy INTEGER,
    ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_vendor_tenant ON InventoryVendor(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_vendor_name ON InventoryVendor(tenant_id, VendorName);
CREATE INDEX IF NOT EXISTS idx_inv_vendor_active ON InventoryVendor(tenant_id, IsActive);

-- ============================================================
-- ITEM CATEGORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryItemCategory (
    ItemCategoryId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    CategoryName TEXT NOT NULL,
    CategoryCode TEXT,
    Description TEXT,
    IsActive INTEGER DEFAULT 1,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy INTEGER,
    ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_category_tenant ON InventoryItemCategory(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_category_name ON InventoryItemCategory(tenant_id, CategoryName);

-- ============================================================
-- ITEM SUBCATEGORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryItemSubCategory (
    SubCategoryId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    ItemCategoryId INTEGER REFERENCES InventoryItemCategory(ItemCategoryId),
    SubCategoryName TEXT NOT NULL,
    SubCategoryCode TEXT,
    Description TEXT,
    IsActive INTEGER DEFAULT 1,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy INTEGER,
    ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_subcategory_tenant ON InventoryItemSubCategory(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_subcategory_cat ON InventoryItemSubCategory(ItemCategoryId);

-- ============================================================
-- UNIT OF MEASUREMENT
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryUnitOfMeasurement (
    UOMId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    UOMName TEXT NOT NULL,
    Description TEXT,
    IsActive INTEGER DEFAULT 1,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_uom_tenant ON InventoryUnitOfMeasurement(tenant_id);

-- ============================================================
-- INVENTORY ITEMS (Master)
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryItem (
    ItemId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    ItemName TEXT NOT NULL,
    ItemCode TEXT,
    ItemCategoryId INTEGER REFERENCES InventoryItemCategory(ItemCategoryId),
    SubCategoryId INTEGER REFERENCES InventoryItemSubCategory(SubCategoryId),
    UOMId INTEGER REFERENCES InventoryUnitOfMeasurement(UOMId),
    StandardRate REAL DEFAULT 0,
    ReOrderLevel INTEGER DEFAULT 0,
    MinStockQuantity INTEGER DEFAULT 0,
    BudgetedQuantity INTEGER DEFAULT 0,
    Description TEXT,
    IsVATApplicable INTEGER DEFAULT 0,
    VATPercentage REAL DEFAULT 0,
    IsFixedAsset INTEGER DEFAULT 0,
    IsActive INTEGER DEFAULT 1,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy INTEGER,
    ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_item_tenant ON InventoryItem(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_item_name ON InventoryItem(tenant_id, ItemName);
CREATE INDEX IF NOT EXISTS idx_inv_item_code ON InventoryItem(tenant_id, ItemCode);
CREATE INDEX IF NOT EXISTS idx_inv_item_category ON InventoryItem(ItemCategoryId);

-- ============================================================
-- STORES / WAREHOUSES
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryStore (
    StoreId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    StoreName TEXT NOT NULL,
    StoreCode TEXT,
    StoreType TEXT DEFAULT 'main', -- main, substore, departmental
    Address TEXT,
    ContactPerson TEXT,
    ContactPhone TEXT,
    ParentStoreId INTEGER REFERENCES InventoryStore(StoreId),
    IsActive INTEGER DEFAULT 1,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy INTEGER,
    ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_store_tenant ON InventoryStore(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_store_name ON InventoryStore(tenant_id, StoreName);
CREATE INDEX IF NOT EXISTS idx_inv_store_type ON InventoryStore(tenant_id, StoreType);

-- ============================================================
-- PURCHASE ORDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryPurchaseOrder (
    PurchaseOrderId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    PONumber TEXT,
    PODate TEXT,
    VendorId INTEGER REFERENCES InventoryVendor(VendorId),
    StoreId INTEGER REFERENCES InventoryStore(StoreId),
    ReferenceNo TEXT,
    POStatus TEXT DEFAULT 'pending', -- pending, partial, complete, cancelled
    SubTotal REAL DEFAULT 0,
    DiscountAmount REAL DEFAULT 0,
    DiscountPercent REAL DEFAULT 0,
    VATAmount REAL DEFAULT 0,
    TotalAmount REAL DEFAULT 0,
    DeliveryAddress TEXT,
    DeliveryDays INTEGER DEFAULT 7,
    ExpectedDeliveryDate TEXT,
    TermsConditions TEXT,
    Remarks TEXT,
    IsVerified INTEGER DEFAULT 0,
    VerifiedBy INTEGER,
    VerifiedOn TEXT,
    IsCancelled INTEGER DEFAULT 0,
    CancelledBy INTEGER,
    CancelledOn TEXT,
    CancelRemarks TEXT,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy INTEGER,
    ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_po_tenant ON InventoryPurchaseOrder(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_po_vendor ON InventoryPurchaseOrder(VendorId);
CREATE INDEX IF NOT EXISTS idx_inv_po_status ON InventoryPurchaseOrder(tenant_id, POStatus);
CREATE INDEX IF NOT EXISTS idx_inv_po_date ON InventoryPurchaseOrder(tenant_id, PODate);

-- ============================================================
-- PURCHASE ORDER ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryPurchaseOrderItem (
    POItemId INTEGER PRIMARY KEY AUTOINCREMENT,
    PurchaseOrderId INTEGER REFERENCES InventoryPurchaseOrder(PurchaseOrderId),
    ItemId INTEGER REFERENCES InventoryItem(ItemId),
    Quantity INTEGER NOT NULL,
    ReceivedQuantity INTEGER DEFAULT 0,
    PendingQuantity INTEGER,
    StandardRate REAL DEFAULT 0,
    VATPercent REAL DEFAULT 0,
    VATAmount REAL DEFAULT 0,
    SubTotal REAL DEFAULT 0,
    TotalAmount REAL DEFAULT 0,
    Remarks TEXT,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_poitem_po ON InventoryPurchaseOrderItem(PurchaseOrderId);
CREATE INDEX IF NOT EXISTS idx_inv_poitem_item ON InventoryPurchaseOrderItem(ItemId);

-- ============================================================
-- GOODS RECEIPT (GRN)
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryGoodsReceipt (
    GoodsReceiptId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    GRNumber TEXT,
    GRDate TEXT,
    VendorId INTEGER REFERENCES InventoryVendor(VendorId),
    PurchaseOrderId INTEGER REFERENCES InventoryPurchaseOrder(PurchaseOrderId),
    StoreId INTEGER REFERENCES InventoryStore(StoreId),
    VendorBillNo TEXT,
    VendorBillDate TEXT,
    PaymentMode TEXT DEFAULT 'credit', -- cash, credit, cheque
    PaymentStatus TEXT DEFAULT 'pending', -- pending, partial, paid
    SubTotal REAL DEFAULT 0,
    DiscountAmount REAL DEFAULT 0,
    DiscountPercent REAL DEFAULT 0,
    VATAmount REAL DEFAULT 0,
    TotalAmount REAL DEFAULT 0,
    PaidAmount REAL DEFAULT 0,
    CreditPeriod INTEGER DEFAULT 30,
    IsDonation INTEGER DEFAULT 0,
    DonationId INTEGER,
    Remarks TEXT,
    IsVerified INTEGER DEFAULT 0,
    VerifiedBy INTEGER,
    VerifiedOn TEXT,
    IsCancelled INTEGER DEFAULT 0,
    CancelledBy INTEGER,
    CancelledOn TEXT,
    CancelRemarks TEXT,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy INTEGER,
    ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_gr_tenant ON InventoryGoodsReceipt(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_gr_vendor ON InventoryGoodsReceipt(VendorId);
CREATE INDEX IF NOT EXISTS idx_inv_gr_po ON InventoryGoodsReceipt(PurchaseOrderId);
CREATE INDEX IF NOT EXISTS idx_inv_gr_date ON InventoryGoodsReceipt(tenant_id, GRDate);
CREATE INDEX IF NOT EXISTS idx_inv_gr_payment ON InventoryGoodsReceipt(tenant_id, PaymentStatus);

-- ============================================================
-- GOODS RECEIPT ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryGoodsReceiptItem (
    GRItemId INTEGER PRIMARY KEY AUTOINCREMENT,
    GoodsReceiptId INTEGER REFERENCES InventoryGoodsReceipt(GoodsReceiptId),
    ItemId INTEGER REFERENCES InventoryItem(ItemId),
    POItemId INTEGER REFERENCES InventoryPurchaseOrderItem(POItemId),
    BatchNo TEXT,
    ExpiryDate TEXT,
    ManufactureDate TEXT,
    ReceivedQuantity INTEGER NOT NULL,
    FreeQuantity INTEGER DEFAULT 0,
    RejectedQuantity INTEGER DEFAULT 0,
    ItemRate REAL NOT NULL,
    MRP REAL,
    VATPercent REAL DEFAULT 0,
    VATAmount REAL DEFAULT 0,
    DiscountPercent REAL DEFAULT 0,
    DiscountAmount REAL DEFAULT 0,
    SubTotal REAL DEFAULT 0,
    TotalAmount REAL DEFAULT 0,
    Remarks TEXT,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_gritem_gr ON InventoryGoodsReceiptItem(GoodsReceiptId);
CREATE INDEX IF NOT EXISTS idx_inv_gritem_item ON InventoryGoodsReceiptItem(ItemId);
CREATE INDEX IF NOT EXISTS idx_inv_gritem_batch ON InventoryGoodsReceiptItem(BatchNo);

-- ============================================================
-- INVENTORY STOCK
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryStock (
    StockId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    ItemId INTEGER REFERENCES InventoryItem(ItemId),
    StoreId INTEGER REFERENCES InventoryStore(StoreId),
    GRItemId INTEGER REFERENCES InventoryGoodsReceiptItem(GRItemId),
    BatchNo TEXT,
    ExpiryDate TEXT,
    AvailableQuantity INTEGER DEFAULT 0,
    CostPrice REAL DEFAULT 0,
    MRP REAL DEFAULT 0,
    IsActive INTEGER DEFAULT 1,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy INTEGER,
    ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_stock_tenant ON InventoryStock(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_stock_item ON InventoryStock(tenant_id, ItemId);
CREATE INDEX IF NOT EXISTS idx_inv_stock_store ON InventoryStock(tenant_id, StoreId);
CREATE INDEX IF NOT EXISTS idx_inv_stock_batch ON InventoryStock(BatchNo);
CREATE INDEX IF NOT EXISTS idx_inv_stock_expiry ON InventoryStock(ExpiryDate);
CREATE INDEX IF NOT EXISTS idx_inv_stock_qty ON InventoryStock(AvailableQuantity);

-- ============================================================
-- REQUISITIONS (Internal demand from departments)
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryRequisition (
    RequisitionId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    RequisitionNo TEXT,
    RequisitionDate TEXT,
    RequestingStoreId INTEGER REFERENCES InventoryStore(StoreId),
    SourceStoreId INTEGER REFERENCES InventoryStore(StoreId),
    DepartmentId INTEGER,
    RequisitionStatus TEXT DEFAULT 'pending', -- pending, approved, partial, complete, cancelled
    Priority TEXT DEFAULT 'normal', -- low, normal, high, urgent
    RequiredDate TEXT,
    Remarks TEXT,
    IsApproved INTEGER DEFAULT 0,
    ApprovedBy INTEGER,
    ApprovedOn TEXT,
    IsCancelled INTEGER DEFAULT 0,
    CancelledBy INTEGER,
    CancelledOn TEXT,
    CancelRemarks TEXT,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy INTEGER,
    ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_req_tenant ON InventoryRequisition(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_req_store ON InventoryRequisition(RequestingStoreId);
CREATE INDEX IF NOT EXISTS idx_inv_req_status ON InventoryRequisition(tenant_id, RequisitionStatus);
CREATE INDEX IF NOT EXISTS idx_inv_req_date ON InventoryRequisition(tenant_id, RequisitionDate);

-- ============================================================
-- REQUISITION ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryRequisitionItem (
    RequisitionItemId INTEGER PRIMARY KEY AUTOINCREMENT,
    RequisitionId INTEGER REFERENCES InventoryRequisition(RequisitionId),
    ItemId INTEGER REFERENCES InventoryItem(ItemId),
    RequestedQuantity INTEGER NOT NULL,
    ApprovedQuantity INTEGER DEFAULT 0,
    DispatchedQuantity INTEGER DEFAULT 0,
    PendingQuantity INTEGER,
    Remarks TEXT,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_reqitem_req ON InventoryRequisitionItem(RequisitionId);
CREATE INDEX IF NOT EXISTS idx_inv_reqitem_item ON InventoryRequisitionItem(ItemId);

-- ============================================================
-- DISPATCH (Fulfill requisitions)
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryDispatch (
    DispatchId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    DispatchNo TEXT,
    DispatchDate TEXT,
    RequisitionId INTEGER REFERENCES InventoryRequisition(RequisitionId),
    SourceStoreId INTEGER REFERENCES InventoryStore(StoreId),
    DestinationStoreId INTEGER REFERENCES InventoryStore(StoreId),
    ReceivedBy TEXT,
    ReceivedOn TEXT,
    Remarks TEXT,
    IsReceived INTEGER DEFAULT 0,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_dispatch_tenant ON InventoryDispatch(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_dispatch_req ON InventoryDispatch(RequisitionId);
CREATE INDEX IF NOT EXISTS idx_inv_dispatch_date ON InventoryDispatch(tenant_id, DispatchDate);

-- ============================================================
-- DISPATCH ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryDispatchItem (
    DispatchItemId INTEGER PRIMARY KEY AUTOINCREMENT,
    DispatchId INTEGER REFERENCES InventoryDispatch(DispatchId),
    RequisitionItemId INTEGER REFERENCES InventoryRequisitionItem(RequisitionItemId),
    ItemId INTEGER REFERENCES InventoryItem(ItemId),
    StockId INTEGER REFERENCES InventoryStock(StockId),
    BatchNo TEXT,
    ExpiryDate TEXT,
    DispatchedQuantity INTEGER NOT NULL,
    CostPrice REAL DEFAULT 0,
    Remarks TEXT,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_dispitem_dispatch ON InventoryDispatchItem(DispatchId);
CREATE INDEX IF NOT EXISTS idx_inv_dispitem_stock ON InventoryDispatchItem(StockId);

-- ============================================================
-- WRITE OFF
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryWriteOff (
    WriteOffId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    WriteOffNo TEXT,
    WriteOffDate TEXT,
    StoreId INTEGER REFERENCES InventoryStore(StoreId),
    Reason TEXT NOT NULL, -- expired, damaged, theft, other
    Description TEXT,
    TotalAmount REAL DEFAULT 0,
    IsApproved INTEGER DEFAULT 0,
    ApprovedBy INTEGER,
    ApprovedOn TEXT,
    Remarks TEXT,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_writeoff_tenant ON InventoryWriteOff(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_writeoff_store ON InventoryWriteOff(StoreId);
CREATE INDEX IF NOT EXISTS idx_inv_writeoff_date ON InventoryWriteOff(tenant_id, WriteOffDate);

-- ============================================================
-- WRITE OFF ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryWriteOffItem (
    WriteOffItemId INTEGER PRIMARY KEY AUTOINCREMENT,
    WriteOffId INTEGER REFERENCES InventoryWriteOff(WriteOffId),
    ItemId INTEGER REFERENCES InventoryItem(ItemId),
    StockId INTEGER REFERENCES InventoryStock(StockId),
    BatchNo TEXT,
    ExpiryDate TEXT,
    Quantity INTEGER NOT NULL,
    ItemRate REAL DEFAULT 0,
    TotalAmount REAL DEFAULT 0,
    Remarks TEXT,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_writeoffitem_writeoff ON InventoryWriteOffItem(WriteOffId);

-- ============================================================
-- STOCK TRANSACTIONS (Audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryStockTransaction (
    TransactionId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    ItemId INTEGER REFERENCES InventoryItem(ItemId),
    StockId INTEGER REFERENCES InventoryStock(StockId),
    StoreId INTEGER REFERENCES InventoryStore(StoreId),
    TransactionType TEXT NOT NULL, -- purchase, requisition, transfer, writeoff, adjustment
    ReferenceNo TEXT,
    ReferenceId INTEGER,
    InQuantity INTEGER DEFAULT 0,
    OutQuantity INTEGER DEFAULT 0,
    BalanceQuantity INTEGER DEFAULT 0,
    TransactionDate TEXT,
    Remarks TEXT,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_trans_tenant ON InventoryStockTransaction(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_trans_item ON InventoryStockTransaction(tenant_id, ItemId);
CREATE INDEX IF NOT EXISTS idx_inv_trans_store ON InventoryStockTransaction(tenant_id, StoreId);
CREATE INDEX IF NOT EXISTS idx_inv_trans_type ON InventoryStockTransaction(TransactionType);
CREATE INDEX IF NOT EXISTS idx_inv_trans_date ON InventoryStockTransaction(TransactionDate);

-- ============================================================
-- RETURN TO VENDOR
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryReturnToVendor (
    ReturnId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    ReturnNo TEXT,
    ReturnDate TEXT,
    VendorId INTEGER REFERENCES InventoryVendor(VendorId),
    GoodsReceiptId INTEGER REFERENCES InventoryGoodsReceipt(GoodsReceiptId),
    StoreId INTEGER REFERENCES InventoryStore(StoreId),
    Reason TEXT,
    TotalAmount REAL DEFAULT 0,
    CreditNoteNo TEXT,
    Remarks TEXT,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_return_tenant ON InventoryReturnToVendor(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_return_vendor ON InventoryReturnToVendor(VendorId);
CREATE INDEX IF NOT EXISTS idx_inv_return_date ON InventoryReturnToVendor(tenant_id, ReturnDate);

-- ============================================================
-- RETURN TO VENDOR ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryReturnToVendorItem (
    ReturnItemId INTEGER PRIMARY KEY AUTOINCREMENT,
    ReturnId INTEGER REFERENCES InventoryReturnToVendor(ReturnId),
    GRItemId INTEGER REFERENCES InventoryGoodsReceiptItem(GRItemId),
    ItemId INTEGER REFERENCES InventoryItem(ItemId),
    BatchNo TEXT,
    ReturnQuantity INTEGER NOT NULL,
    ItemRate REAL DEFAULT 0,
    TotalAmount REAL DEFAULT 0,
    Remarks TEXT,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_returnitem_return ON InventoryReturnToVendorItem(ReturnId);

-- ============================================================
-- VENDOR TERMS
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryVendorTerms (
    TermsId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    TermsText TEXT NOT NULL,
    IsActive INTEGER DEFAULT 1,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_terms_tenant ON InventoryVendorTerms(tenant_id);

-- ============================================================
-- REQUEST FOR QUOTATION (RFQ)
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryRequestForQuotation (
    RFQId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    RFQNo TEXT,
    Subject TEXT,
    Description TEXT,
    RequestedOn TEXT,
    RequestedBy INTEGER,
    RequestedCloseDate TEXT,
    Status TEXT DEFAULT 'active', -- active, closed, cancelled
    IsActive INTEGER DEFAULT 1,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy INTEGER,
    ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_rfq_tenant ON InventoryRequestForQuotation(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_rfq_status ON InventoryRequestForQuotation(tenant_id, Status);

-- ============================================================
-- RFQ ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryRequestForQuotationItem (
    RFQItemId INTEGER PRIMARY KEY AUTOINCREMENT,
    RFQId INTEGER REFERENCES InventoryRequestForQuotation(RFQId),
    ItemId INTEGER REFERENCES InventoryItem(ItemId),
    Quantity INTEGER NOT NULL,
    Description TEXT,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_rfqitem_rfq ON InventoryRequestForQuotationItem(RFQId);

-- ============================================================
-- RFQ VENDORS
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryRequestForQuotationVendor (
    RFQVendorId INTEGER PRIMARY KEY AUTOINCREMENT,
    RFQId INTEGER REFERENCES InventoryRequestForQuotation(RFQId),
    VendorId INTEGER REFERENCES InventoryVendor(VendorId),
    IsActive INTEGER DEFAULT 1,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_rfqvendor_rfq ON InventoryRequestForQuotationVendor(RFQId);
CREATE INDEX IF NOT EXISTS idx_inv_rfqvendor_vendor ON InventoryRequestForQuotationVendor(VendorId);

-- ============================================================
-- QUOTATION (Vendor Response)
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryQuotation (
    QuotationId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    RFQId INTEGER REFERENCES InventoryRequestForQuotation(RFQId),
    VendorId INTEGER REFERENCES InventoryVendor(VendorId),
    QuotationNo TEXT,
    QuotationDate TEXT,
    Status TEXT DEFAULT 'pending', -- pending, selected, rejected
    TotalPrice REAL DEFAULT 0,
    ReferenceNo TEXT,
    Remarks TEXT,
    IsActive INTEGER DEFAULT 1,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy INTEGER,
    ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_quotation_tenant ON InventoryQuotation(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_quotation_rfq ON InventoryQuotation(RFQId);
CREATE INDEX IF NOT EXISTS idx_inv_quotation_vendor ON InventoryQuotation(VendorId);

-- ============================================================
-- QUOTATION ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryQuotationItem (
    QuotationItemId INTEGER PRIMARY KEY AUTOINCREMENT,
    QuotationId INTEGER REFERENCES InventoryQuotation(QuotationId),
    ItemId INTEGER REFERENCES InventoryItem(ItemId),
    QuotedQuantity INTEGER,
    QuotedRate REAL NOT NULL,
    Description TEXT,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_quotitem_quot ON InventoryQuotationItem(QuotationId);

-- ============================================================
-- PURCHASE ORDER DRAFTS
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryPurchaseOrderDraft (
    DraftPurchaseOrderId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    DraftPurchaseOrderNo TEXT,
    FiscalYearId INTEGER,
    VendorId INTEGER REFERENCES InventoryVendor(VendorId),
    Status TEXT DEFAULT 'active', -- active, discarded, converted
    SubTotal REAL DEFAULT 0,
    VATAmount REAL DEFAULT 0,
    TotalAmount REAL DEFAULT 0,
    DeliveryDate TEXT,
    Remarks TEXT,
    IsActive INTEGER DEFAULT 1,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy INTEGER,
    ModifiedOn TEXT,
    DiscardedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_podraft_tenant ON InventoryPurchaseOrderDraft(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_podraft_vendor ON InventoryPurchaseOrderDraft(VendorId);

-- ============================================================
-- PURCHASE ORDER DRAFT ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryPurchaseOrderDraftItem (
    DraftPurchaseOrderItemId INTEGER PRIMARY KEY AUTOINCREMENT,
    DraftPurchaseOrderId INTEGER REFERENCES InventoryPurchaseOrderDraft(DraftPurchaseOrderId),
    ItemId INTEGER REFERENCES InventoryItem(ItemId),
    Quantity INTEGER,
    ItemRate REAL,
    VATPercentage REAL DEFAULT 0,
    VATAmount REAL DEFAULT 0,
    TotalAmount REAL DEFAULT 0,
    Remarks TEXT,
    IsActive INTEGER DEFAULT 1,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy INTEGER,
    ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_podraftitem_draft ON InventoryPurchaseOrderDraftItem(DraftPurchaseOrderId);

-- ============================================================
-- SUBSTORE RETURN (Internal Return)
-- ============================================================
CREATE TABLE IF NOT EXISTS InventorySubstoreReturn (
    ReturnId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    ReturnDate TEXT,
    TargetStoreId INTEGER REFERENCES InventoryStore(StoreId),
    SourceStoreId INTEGER REFERENCES InventoryStore(StoreId),
    Remarks TEXT,
    ReceivedBy INTEGER,
    ReceivedOn TEXT,
    ReceivedRemarks TEXT,
    IsActive INTEGER DEFAULT 1,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_subret_tenant ON InventorySubstoreReturn(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_subret_target ON InventorySubstoreReturn(TargetStoreId);
CREATE INDEX IF NOT EXISTS idx_inv_subret_source ON InventorySubstoreReturn(SourceStoreId);

-- ============================================================
-- SUBSTORE RETURN ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS InventorySubstoreReturnItem (
    ReturnItemId INTEGER PRIMARY KEY AUTOINCREMENT,
    ReturnId INTEGER REFERENCES InventorySubstoreReturn(ReturnId),
    ItemId INTEGER REFERENCES InventoryItem(ItemId),
    BatchNo TEXT,
    ReturnQuantity INTEGER NOT NULL,
    Remarks TEXT,
    ReceivedQuantity INTEGER DEFAULT 0,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_subretitem_ret ON InventorySubstoreReturnItem(ReturnId);

-- ============================================================
-- FISCAL YEAR
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryFiscalYear (
    FiscalYearId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    FiscalYearName TEXT,
    StartDate TEXT,
    EndDate TEXT,
    IsActive INTEGER DEFAULT 1,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_fy_tenant ON InventoryFiscalYear(tenant_id);

-- ============================================================
-- FIXED ASSET STOCK
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryFixedAssetStock (
    FixedAssetStockId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    ItemId INTEGER REFERENCES InventoryItem(ItemId),
    StoreId INTEGER REFERENCES InventoryStore(StoreId),
    BarCodeNumber TEXT,
    SerialNumber TEXT,
    BatchNo TEXT,
    Status TEXT DEFAULT 'active', -- active, damaged, disposed
    IsActive INTEGER DEFAULT 1,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy INTEGER,
    ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_fastock_tenant ON InventoryFixedAssetStock(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_fastock_item ON InventoryFixedAssetStock(ItemId);
CREATE INDEX IF NOT EXISTS idx_inv_fastock_barcode ON InventoryFixedAssetStock(BarCodeNumber);

-- ============================================================
-- FIXED ASSET DONATION
-- ============================================================
CREATE TABLE IF NOT EXISTS InventoryFixedAssetDonation (
    DonationId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    DonationName TEXT,
    DonorName TEXT,
    DonationDate TEXT,
    TotalValue REAL DEFAULT 0,
    Remarks TEXT,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_donation_tenant ON InventoryFixedAssetDonation(tenant_id);
