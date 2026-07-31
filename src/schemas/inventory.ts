import { z } from "zod";

// ============================================================
// QUERY SCHEMAS (Common)
// ============================================================
const paginationSchema = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(1000).default(20),
};

// ============================================================
// VENDOR SCHEMAS
// ============================================================
export const createVendorSchema = z.object({
  VendorName: z.string().min(1, "Vendor name is required"),
  VendorCode: z.string().optional(),
  ContactPerson: z.string().optional(),
  ContactPhone: z.string().optional(),
  ContactEmail: z.string().email().optional().or(z.literal("")),
  ContactAddress: z.string().optional(),
  City: z.string().optional(),
  Country: z.string().optional(),
  PANNo: z.string().optional(),
  CreditPeriod: z.number().int().default(30),
  IsActive: z.boolean().default(true),
  IsTDSApplicable: z.boolean().default(false),
  TDSPercent: z.number().default(0),
});

export const updateVendorSchema = createVendorSchema.partial();

export const listVendorsSchema = z.object({
  ...paginationSchema,
  search: z.string().optional(),
  IsActive: z.string().optional(),
});

// ============================================================
// CATEGORY SCHEMAS
// ============================================================
export const createCategorySchema = z.object({
  CategoryName: z.string().min(1, "Category name is required"),
  CategoryCode: z.string().optional(),
  Description: z.string().optional(),
  IsActive: z.boolean().default(true),
});

export const updateCategorySchema = createCategorySchema.partial();

export const listCategoriesSchema = z.object({
  ...paginationSchema,
  search: z.string().optional(),
});

// ============================================================
// SUBCATEGORY SCHEMAS
// ============================================================
export const createSubCategorySchema = z.object({
  ItemCategoryId: z.number().int().positive(),
  SubCategoryName: z.string().min(1, "SubCategory name is required"),
  SubCategoryCode: z.string().optional(),
  Description: z.string().optional(),
  IsActive: z.boolean().default(true),
});

export const updateSubCategorySchema = createSubCategorySchema.partial();

export const listSubCategoriesSchema = z.object({
  ...paginationSchema,
  ItemCategoryId: z.coerce.number().int().positive().optional(),
  search: z.string().optional(),
});

// ============================================================
// UOM SCHEMAS
// ============================================================
export const createUOMSchema = z.object({
  UOMName: z.string().min(1, "UOM name is required"),
  Description: z.string().optional(),
  IsActive: z.boolean().default(true),
});

export const listUOMSchema = z.object({
  ...paginationSchema,
  search: z.string().optional(),
});

// ============================================================
// ITEM SCHEMAS
// ============================================================
const itemSchema = z.object({
  ItemName: z.string().min(1, "Item name is required"),
  ItemCode: z.string().optional(),
  ItemType: z.enum(["medicine", "consumable", "lab_reagent", "radiology_consumable", "ot_item", "ward_item", "general", "asset", "equipment"]).default("general"),
  GenericName: z.string().optional(),
  BrandName: z.string().optional(),
  ManufacturerName: z.string().optional(),
  Strength: z.string().optional(),
  DosageForm: z.string().optional(),
  ItemCategoryId: z.number().int().positive().optional(),
  SubCategoryId: z.number().int().positive().optional(),
  UOMId: z.number().int().positive().optional(),
  PurchaseUnit: z.string().optional(),
  IssueUnit: z.string().optional(),
  UnitConversionFactor: z.number().positive().default(1),
  SupplierId: z.number().int().positive().optional(),
  Barcode: z.string().optional(),
  IsBatchRequired: z.boolean().default(false),
  IsExpiryRequired: z.boolean().default(false),
  IsSerialRequired: z.boolean().default(false),
  StandardRate: z.number().default(0),
  ReOrderLevel: z.number().int().default(0),
  MinStockQuantity: z.number().int().default(0),
  MaxStockQuantity: z.number().int().default(0),
  BudgetedQuantity: z.number().int().default(0),
  PurchasePrice: z.number().default(0),
  SalePrice: z.number().default(0),
  Description: z.string().optional(),
  IsVATApplicable: z.boolean().default(false),
  VATPercentage: z.number().default(0),
  StorageCondition: z.string().optional(),
  RackShelf: z.string().optional(),
  Chargeable: z.boolean().default(false),
  BillingServiceItemId: z.number().int().positive().optional(),
  MedicineMeta: z.record(z.unknown()).optional(),
  LabMeta: z.record(z.unknown()).optional(),
  AssetMeta: z.record(z.unknown()).optional(),
  IsFixedAsset: z.boolean().default(false),
  IsActive: z.boolean().default(true),
});

function requireReagentLotTracking(
  value: { ItemType?: string; IsBatchRequired?: boolean; IsExpiryRequired?: boolean },
  ctx: z.RefinementCtx,
): void {
  if (value.ItemType !== 'lab_reagent') return;
  if (value.IsBatchRequired !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['IsBatchRequired'],
      message: 'Lab reagent items must require batch tracking',
    });
  }
  if (value.IsExpiryRequired !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['IsExpiryRequired'],
      message: 'Lab reagent items must require expiry tracking',
    });
  }
}

export const createItemSchema = itemSchema.superRefine(requireReagentLotTracking);
export const updateItemSchema = itemSchema.partial().superRefine(requireReagentLotTracking);

export const listItemsSchema = z.object({
  ...paginationSchema,
  search: z.string().optional(),
  ItemCategoryId: z.coerce.number().int().positive().optional(),
  SubCategoryId: z.coerce.number().int().positive().optional(),
  IsActive: z.string().optional(),
});

// ============================================================
// STORE SCHEMAS
// ============================================================
export const createStoreSchema = z.object({
  StoreName: z.string().min(1, "Store name is required"),
  StoreCode: z.string().optional(),
  StoreType: z.enum(["main", "substore", "departmental"]).default("main"),
  Address: z.string().optional(),
  ContactPerson: z.string().optional(),
  ContactPhone: z.string().optional(),
  ParentStoreId: z.number().int().positive().optional(),
  IsActive: z.boolean().default(true),
});

export const updateStoreSchema = createStoreSchema.partial();

export const listStoresSchema = z.object({
  ...paginationSchema,
  search: z.string().optional(),
  StoreType: z.string().optional(),
});

// ============================================================
// PURCHASE ORDER SCHEMAS
// ============================================================
const poItemSchema = z.object({
  ItemId: z.number().int().positive(),
  Quantity: z.number().int().positive(),
  StandardRate: z.number().positive(),
  VATPercent: z.number().default(0),
  Remarks: z.string().optional(),
});

export const createPurchaseOrderSchema = z.object({
  VendorId: z.number().int().positive(),
  StoreId: z.number().int().positive().optional(),
  PODate: z.string().optional(),
  ReferenceNo: z.string().optional(),
  DeliveryAddress: z.string().optional(),
  DeliveryDays: z.number().int().default(7),
  ExpectedDeliveryDate: z.string().optional(),
  TermsConditions: z.string().optional(),
  Remarks: z.string().optional(),
  Items: z.array(poItemSchema).min(1, "At least one item is required"),
});

export const updatePurchaseOrderSchema = z.object({
  POStatus: z.enum(["pending", "partial", "complete", "cancelled"]).optional(),
  ExpectedDeliveryDate: z.string().optional(),
  CancelRemarks: z.string().optional(),
});

export const approvePurchaseOrderSchema = z.object({
  Remarks: z.string().max(1000).optional(),
});

export const rejectPurchaseOrderSchema = z.object({
  Remarks: z.string().max(1000).optional(),
});

export const listPurchaseOrdersSchema = z.object({
  ...paginationSchema,
  VendorId: z.coerce.number().int().positive().optional(),
  StoreId: z.coerce.number().int().positive().optional(),
  POStatus: z.string().optional(),
  FromDate: z.string().optional(),
  ToDate: z.string().optional(),
});

// ============================================================
// GOODS RECEIPT SCHEMAS
// ============================================================
const grItemSchema = z.object({
  ItemId: z.number().int().positive(),
  POItemId: z.number().int().positive().optional(),
  BatchNo: z.string().optional(),
  ExpiryDate: z.string().optional(),
  ManufactureDate: z.string().optional(),
  ReceivedQuantity: z.number().int().positive(),
  FreeQuantity: z.number().int().default(0),
  RejectedQuantity: z.number().int().default(0),
  ItemRate: z.number().positive(),
  MRP: z.number().optional(),
  VATPercent: z.number().default(0),
  DiscountPercent: z.number().default(0),
  Remarks: z.string().optional(),
});

export const createGoodsReceiptSchema = z.object({
  IdempotencyKey: z.string().min(8).max(128).optional(),
  VendorId: z.number().int().positive(),
  PurchaseOrderId: z.number().int().positive().optional(),
  StoreId: z.number().int().positive(),
  GRDate: z.string(),
  VendorBillNo: z.string().optional(),
  VendorBillDate: z.string().optional(),
  PaymentMode: z.enum(["cash", "credit", "cheque"]).default("credit"),
  DiscountPercent: z.number().default(0),
  DiscountAmount: z.number().default(0),
  FreightAmount: z.number().default(0),
  InsuranceAmount: z.number().default(0),
  OtherCharges: z.number().default(0),
  CreditPeriod: z.number().int().default(30),
  IsDonation: z.boolean().default(false),
  Remarks: z.string().optional(),
  Items: z.array(grItemSchema).min(1, "At least one item is required"),
});

export const verifyGoodsReceiptSchema = z.object({
  Remarks: z.string().max(1000).optional(),
});

export const listGoodsReceiptsSchema = z.object({
  ...paginationSchema,
  VendorId: z.coerce.number().int().positive().optional(),
  StoreId: z.coerce.number().int().positive().optional(),
  PurchaseOrderId: z.coerce.number().int().positive().optional(),
  PaymentStatus: z.string().optional(),
  FromDate: z.string().optional(),
  ToDate: z.string().optional(),
});

// ============================================================
// STOCK SCHEMAS
// ============================================================
export const listStockSchema = z.object({
  ...paginationSchema,
  search: z.string().optional(),
  ItemId: z.coerce.number().int().positive().optional(),
  StoreId: z.coerce.number().int().positive().optional(),
  ExpiringBefore: z.string().optional(),
  BelowReorderLevel: z.string().optional(),
  LowStock: z.string().optional(),
});

// ============================================================
// REQUISITION SCHEMAS
// ============================================================
const reqItemSchema = z.object({
  ItemId: z.number().int().positive(),
  RequestedQuantity: z.number().int().positive(),
  Remarks: z.string().optional(),
});

export const createRequisitionSchema = z.object({
  RequestingStoreId: z.number().int().positive(),
  SourceStoreId: z.number().int().positive().optional(),
  DepartmentId: z.number().int().positive().optional(),
  Priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  RequiredDate: z.string().optional(),
  Remarks: z.string().optional(),
  Items: z.array(reqItemSchema).min(1, "At least one item is required"),
});

export const updateRequisitionSchema = z.object({
  RequisitionStatus: z.enum(["pending", "approved", "partial", "complete", "cancelled"]).optional(),
  IsApproved: z.boolean().optional(),
  CancelRemarks: z.string().optional(),
});

export const approveRequisitionItemSchema = z.object({
  ApprovedQuantity: z.number().int().min(0),
});

export const listRequisitionsSchema = z.object({
  ...paginationSchema,
  RequestingStoreId: z.coerce.number().int().positive().optional(),
  SourceStoreId: z.coerce.number().int().positive().optional(),
  RequisitionStatus: z.string().optional(),
  Priority: z.string().optional(),
  FromDate: z.string().optional(),
  ToDate: z.string().optional(),
});

// ============================================================
// DISPATCH SCHEMAS
// ============================================================
const dispatchItemSchema = z.object({
  RequisitionItemId: z.number().int().positive().optional(),
  ItemId: z.number().int().positive(),
  StockId: z.number().int().positive().optional(),
  BatchNo: z.string().optional(),
  DispatchedQuantity: z.number().int().positive(),
  Remarks: z.string().optional(),
});

export const createDispatchSchema = z.object({
  RequisitionId: z.number().int().positive().optional(),
  SourceStoreId: z.number().int().positive(),
  DestinationStoreId: z.number().int().positive(),
  Remarks: z.string().optional(),
  Items: z.array(dispatchItemSchema).min(1, "At least one item is required"),
});

export const receiveDispatchSchema = z.object({
  ReceivedBy: z.string(),
});

export const listDispatchesSchema = z.object({
  ...paginationSchema,
  RequisitionId: z.coerce.number().int().positive().optional(),
  SourceStoreId: z.coerce.number().int().positive().optional(),
  DestinationStoreId: z.coerce.number().int().positive().optional(),
  IsReceived: z.string().optional(),
  FromDate: z.string().optional(),
  ToDate: z.string().optional(),
});

// ============================================================
// WRITE OFF SCHEMAS
// ============================================================
const writeOffItemSchema = z.object({
  ItemId: z.number().int().positive(),
  StockId: z.number().int().positive(),
  Quantity: z.number().int().positive(),
  Remarks: z.string().optional(),
});

export const createWriteOffSchema = z.object({
  StoreId: z.number().int().positive(),
  Reason: z.enum(["expired", "damaged", "theft", "other"]),
  Description: z.string().optional(),
  Remarks: z.string().optional(),
  Items: z.array(writeOffItemSchema).min(1, "At least one item is required"),
});

export const approveWriteOffSchema = z.object({
  IsApproved: z.boolean(),
  Remarks: z.string().max(1000).optional(),
});

export const rejectWriteOffSchema = z.object({
  Remarks: z.string().max(1000).optional(),
});

export const listWriteOffsSchema = z.object({
  ...paginationSchema,
  StoreId: z.coerce.number().int().positive().optional(),
  Reason: z.string().optional(),
  IsApproved: z.string().optional(),
  FromDate: z.string().optional(),
  ToDate: z.string().optional(),
});

// ============================================================
// RETURN TO VENDOR SCHEMAS
// ============================================================
const returnItemSchema = z.object({
  GRItemId: z.number().int().positive(),
  ItemId: z.number().int().positive(),
  ReturnQuantity: z.number().int().positive(),
  Remarks: z.string().optional(),
});

export const createReturnToVendorSchema = z.object({
  VendorId: z.number().int().positive(),
  GoodsReceiptId: z.number().int().positive(),
  StoreId: z.number().int().positive(),
  Reason: z.string(),
  CreditNoteNo: z.string().optional(),
  Remarks: z.string().optional(),
  Items: z.array(returnItemSchema).min(1, "At least one item is required"),
});

export const listReturnToVendorSchema = z.object({
  ...paginationSchema,
  VendorId: z.coerce.number().int().positive().optional(),
  StoreId: z.coerce.number().int().positive().optional(),
  FromDate: z.string().optional(),
  ToDate: z.string().optional(),
});



// ============================================================
// RFQ SCHEMAS
// ============================================================
const rfqItemSchema = z.object({
  ItemId: z.number().int().positive(),
  Quantity: z.number().int().positive(),
  Description: z.string().optional(),
});

export const createRFQSchema = z.object({
  Subject: z.string().min(1, "Subject is required"),
  Description: z.string().optional(),
  RequestedCloseDate: z.string().optional(),
  Items: z.array(rfqItemSchema).min(1, "At least one item is required"),
  VendorIds: z.array(z.number().int().positive()).optional(), // Optional: Invite vendors immediately
});

export const listRFQSchema = z.object({
  ...paginationSchema,
  Status: z.string().optional(),
  FromDate: z.string().optional(),
  ToDate: z.string().optional(),
});

// ============================================================
// QUOTATION SCHEMAS
// ============================================================
const quoteItemSchema = z.object({
  ItemId: z.number().int().positive(),
  QuotedQuantity: z.number().int().positive().optional(),
  QuotedRate: z.number().positive(),
  Description: z.string().optional(),
});

export const createQuotationSchema = z.object({
  RFQId: z.number().int().positive(),
  VendorId: z.number().int().positive(),
  QuotationNo: z.string().optional(),
  QuotationDate: z.string().optional(),
  RefrenceNo: z.string().optional(),
  Remarks: z.string().optional(),
  Items: z.array(quoteItemSchema).min(1, "At least one item is required"),
});

export const listQuotationsSchema = z.object({
  ...paginationSchema,
  RFQId: z.coerce.number().int().positive().optional(),
  VendorId: z.coerce.number().int().positive().optional(),
  Status: z.string().optional(),
});

// ============================================================
// STOCK TRANSACTION SCHEMAS
// ============================================================
export const listStockTransactionsSchema = z.object({
  ...paginationSchema,
  ItemId: z.coerce.number().int().positive().optional(),
  StoreId: z.coerce.number().int().positive().optional(),
  TransactionType: z.string().optional(),
  FromDate: z.string().optional(),
  ToDate: z.string().optional(),
});

// ============================================================
// RECEIVE DISPATCH
// ============================================================
export const receiveDispatchPayloadSchema = z.object({
  ReceivedRemarks: z.string().optional(),
});

// ============================================================
// EXPORT TYPES
// ============================================================

// ============================================================
// DRAFT PO SCHEMAS
// ============================================================
const draftItemSchema = z.object({
  ItemId: z.number().int().positive(),
  Quantity: z.number().int().positive().optional(),
  ItemRate: z.number().optional(),
  VATPercentage: z.number().default(0),
  Remarks: z.string().optional(),
});

export const createPODraftSchema = z.object({
  VendorId: z.number().int().positive().optional(),
  FiscalYearId: z.number().int().optional(),
  DeliveryDate: z.string().optional(),
  Remarks: z.string().optional(),
  Items: z.array(draftItemSchema),
});

export const updatePODraftSchema = createPODraftSchema.partial().extend({
  Status: z.enum(["active", "discarded", "converted"]).optional(),
});

export const listPODraftsSchema = z.object({
  ...paginationSchema,
  Status: z.string().optional(),
});

// ============================================================
// SUBSTORE RETURN SCHEMAS
// ============================================================
const returnFromSubstoreItemSchema = z.object({
  ItemId: z.number().int().positive(),
  BatchNo: z.string().optional(),
  ReturnQuantity: z.number().int().positive(),
  Remarks: z.string().optional(),
});

export const createSubstoreReturnSchema = z.object({
  TargetStoreId: z.number().int().positive(),
  SourceStoreId: z.number().int().positive(),
  Remarks: z.string().optional(),
  Items: z.array(returnFromSubstoreItemSchema).min(1),
});

export const listSubstoreReturnsSchema = z.object({
  ...paginationSchema,
  TargetStoreId: z.coerce.number().int().positive().optional(),
  SourceStoreId: z.coerce.number().int().positive().optional(),
});

// ============================================================
// STOCK ADJUSTMENT SCHEMAS
// ============================================================
const stockAdjustmentItemSchema = z.object({
  StockId: z.number().int().positive().optional(), // If known
  ItemId: z.number().int().positive(),
  StoreId: z.number().int().positive().optional(),
  BatchNo: z.string().optional(),
  ExpiryDate: z.string().optional(),
  InQuantity: z.number().int().default(0), // adjustment quantity (positive to add, negative to subtract) or absolute?
  // Using explicit NewQuantity matches "Reconciliation" usually
  NewQuantity: z.number().int().min(0).optional(),
  // Or In/Out? Let's use In/Out for adjustment transaction type
  AdjustmentType: z.enum(["in", "out", "add", "subtract"]),
  Quantity: z.number().int().positive(),
  Remarks: z.string().optional(),
});

export const createStockAdjustmentSchema = z.object({
  StoreId: z.number().int().positive().optional(),
  Items: z.array(stockAdjustmentItemSchema).min(1),
  Remarks: z.string().optional(),
});

// ============================================================
// DONATION SCHEMAS
// ============================================================
export const createDonationSchema = z.object({
  DonationName: z.string().min(1, "Donation name is required"),
  DonorName: z.string().optional(),
  DonationDate: z.string().optional(),
  TotalValue: z.number().default(0),
  Remarks: z.string().optional(),
});

export const updateDonationSchema = createDonationSchema.partial();

export const listDonationsSchema = z.object({
  ...paginationSchema,
  search: z.string().optional(),
  FromDate: z.string().optional(),
  ToDate: z.string().optional(),
});

// ============================================================
// TYPES
// ============================================================
export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type CreateItemInput = z.infer<typeof createItemSchema>;
export type CreateStoreInput = z.infer<typeof createStoreSchema>;
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type CreateGoodsReceiptInput = z.infer<typeof createGoodsReceiptSchema>;
export type CreateRequisitionInput = z.infer<typeof createRequisitionSchema>;
export type CreateDispatchInput = z.infer<typeof createDispatchSchema>;
export type CreateWriteOffInput = z.infer<typeof createWriteOffSchema>;
export type CreateReturnToVendorInput = z.infer<typeof createReturnToVendorSchema>;
