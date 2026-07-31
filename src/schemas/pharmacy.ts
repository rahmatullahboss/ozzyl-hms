import { z } from 'zod';

// ─── Backward-compatible schemas (existing endpoints) ─────────────────────────

export const createMedicineSchema = z.object({
  name: z.string().min(1, 'Medicine name is required'),
  genericName: z.string().optional(),
  company: z.string().optional(),
  unit: z.string().optional(),
  salePrice: z.number().int().nonnegative('Sale price required'),
  reorderLevel: z.number().int().nonnegative().default(10),
});

export const updateMedicineSchema = createMedicineSchema.partial();

export const createSupplierSchema = z.object({
  name: z.string().min(1, 'Supplier name required'),
  mobileNumber: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
});

export const updateSupplierSchema = createSupplierSchema.partial();

const purchaseItemSchema = z.object({
  medicineId: z.number().int().positive('Medicine ID required'),
  batchNo: z.string().min(1, 'Batch number required'),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry date must be YYYY-MM-DD'),
  quantity: z.number().int().positive('Quantity must be positive'),
  purchasePrice: z.number().int().nonnegative('Purchase price required'),
  salePrice: z.number().int().nonnegative('Sale price required'),
});

export const createPurchaseSchema = z.object({
  supplierId: z.number().int().positive('Supplier ID required'),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Purchase date must be YYYY-MM-DD'),
  items: z.array(purchaseItemSchema).min(1, 'At least one item required'),
  discount: z.number().int().nonnegative().default(0),
});

const saleItemSchema = z.object({
  medicineId: z.number().int().positive(),
  quantity: z.number().int().positive('Quantity must be positive'),
  unitPrice: z.number().int().nonnegative(),
});

export const createSaleSchema = z.object({
  patientId: z.number().int().positive().optional(),
  billId: z.number().int().positive().optional(),
  items: z.array(saleItemSchema).min(1),
  discount: z.number().int().nonnegative().default(0),
});

const pharmacyBillItemSchema = z.object({
  medicineId: z.number().int().positive(),
  name: z.string().min(1, 'Item name required'),
  quantity: z.number().int().positive('Quantity must be positive'),
  unitPrice: z.number().int().nonnegative('Unit price required'),
});

export const createPharmacyBillSchema = z.object({
  patientId: z.number().int().positive().optional(),
  items: z.array(pharmacyBillItemSchema).min(1, 'At least one item required'),
  discount: z.number().int().nonnegative().default(0),
  paymentMethod: z.enum(['cash', 'bkash', 'bank', 'other']).optional(),
});

// ─── Phase 1: Master Data Schemas ────────────────────────────────────────────

export const createCategorySchema = z.object({
  name: z.string().min(1, 'Category name required'),
  description: z.string().optional(),
});
export const updateCategorySchema = createCategorySchema.partial();

export const createGenericSchema = z.object({
  name: z.string().min(1, 'Generic name required'),
  categoryId: z.number().int().positive().optional(),
  description: z.string().optional(),
});
export const updateGenericSchema = createGenericSchema.partial();

export const createPharmacySupplierSchema = z.object({
  name: z.string().min(1, 'Supplier name required'),
  contactNo: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  email: z.string().email().optional(),
  panNo: z.string().optional(),
  creditPeriod: z.number().int().nonnegative().default(0),
  notes: z.string().optional(),
});
export const updatePharmacySupplierSchema = createPharmacySupplierSchema.partial();

export const createUOMSchema = z.object({
  name: z.string().min(1, 'UOM name required'),
  description: z.string().optional(),
});

export const createPackingTypeSchema = z.object({
  name: z.string().min(1, 'Packing type name required'),
  quantity: z.number().int().positive('Packing quantity must be positive').default(1),
});

export const createRackSchema = z.object({
  rackNo: z.string().min(1, 'Rack number required').optional(),
  name: z.string().min(1, 'Rack number required').optional(),
  description: z.string().optional(),
  parentId: z.number().int().positive().optional(),
}).refine((data) => Boolean(data.rackNo ?? data.name), {
  message: 'Rack number required',
  path: ['rackNo'],
}).transform((data) => ({
  rackNo: data.rackNo ?? data.name!,
  description: data.description,
  parentId: data.parentId,
}));

export const createPharmacyItemSchema = z.object({
  name: z.string().min(1, 'Item name required'),
  itemCode: z.string().optional(),
  genericId: z.number().int().positive().optional(),
  categoryId: z.number().int().positive().optional(),
  uomId: z.number().int().positive().optional(),
  packingTypeId: z.number().int().positive().optional(),
  reorderLevel: z.number().int().nonnegative().default(0),
  minStockQty: z.number().int().nonnegative().default(0),
  purchaseVatPct: z.number().min(0).max(100).default(0),
  salesVatPct: z.number().min(0).max(100).default(0),
  isVatApplicable: z.boolean().default(false),
  isNarcotic: z.boolean().default(false),
});
export const updatePharmacyItemSchema = createPharmacyItemSchema.partial();

// ─── Phase 2: Purchase Flow Schemas ──────────────────────────────────────────

const poItemSchema = z.object({
  itemId: z.number().int().positive(),
  quantity: z.number().positive(),
  standardRate: z.number().int().nonnegative(),   // paisa
  vatAmount: z.number().int().nonnegative().default(0), // paisa
  remarks: z.string().optional(),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.number().int().positive(),
  poDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  referenceNo: z.string().optional(),
  discountAmount: z.number().int().nonnegative().default(0),      // paisa
  discountPct: z.number().min(0).max(100).default(0),
  vatAmount: z.number().int().nonnegative().default(0),           // paisa
  adjustment: z.number().int().default(0),                       // paisa
  deliveryAddress: z.string().optional(),
  deliveryDays: z.number().int().nonnegative().default(0),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  remarks: z.string().optional(),
  termsConditions: z.string().optional(),
  items: z.array(poItemSchema).min(1),
});

export const updatePurchaseOrderSchema = z.object({
  referenceNo: z.string().optional(),
  remarks: z.string().optional(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  termsConditions: z.string().optional(),
});

export const cancelPurchaseOrderSchema = z.object({
  cancelRemarks: z.string().min(1, 'Cancellation reason required'),
});

const grnItemSchema = z.object({
  itemId: z.number().int().positive(),
  batchNo: z.string().min(1, 'Batch number required'),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  receivedQty: z.number().positive(),
  freeQty: z.number().nonnegative().default(0),
  rejectedQty: z.number().nonnegative().default(0),
  itemRate: z.number().int().nonnegative(),     // paisa (cost price)
  mrp: z.number().int().nonnegative(),          // paisa
  discountPct: z.number().min(0).max(100).default(0),
  vatPct: z.number().min(0).max(100).default(0),
  salePrice: z.number().int().nonnegative(),    // paisa
  manufactureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const createGoodsReceiptSchema = z.object({
  poId: z.number().int().positive().optional(),
  supplierId: z.number().int().positive(),
  invoiceNo: z.string().optional(),
  grnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  supplierBillDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  discountPct: z.number().min(0).max(100).default(0),
  discountAmount: z.number().int().nonnegative().default(0),
  vatPct: z.number().min(0).max(100).default(0),
  adjustment: z.number().int().default(0),
  creditPeriod: z.number().int().nonnegative().default(0),
  remarks: z.string().optional(),
  isItemDiscountApplicable: z.boolean().default(false),
  items: z.array(grnItemSchema).min(1),
});

// ─── Phase 3: Stock Schemas ───────────────────────────────────────────────────

export const stockAdjustmentSchema = z.object({
  stockId: z.number().int().positive(),
  itemId: z.number().int().positive(),
  adjustmentType: z.enum(['in', 'out']),
  quantity: z.number().positive(),
  remarks: z.string().min(1, 'Adjustment reason required'),
});

// ─── Phase 4: Invoice / Sales Schemas ────────────────────────────────────────

const invoiceItemSchema = z.object({
  itemId: z.number().int().positive(),
  stockId: z.number().int().positive(),
  batchNo: z.string().min(1),
  expiryDate: z.string().optional(),
  quantity: z.number().positive(),
  mrp: z.number().int().nonnegative(),          // paisa
  price: z.number().int().nonnegative(),         // paisa
  discountPct: z.number().min(0).max(100).default(0),
  vatPct: z.number().min(0).max(100).default(0),
});

export const createInvoiceSchema = z.object({
  patientId: z.number().int().positive().optional(),
  patientVisitId: z.number().int().positive().optional(),
  counterId: z.number().int().positive().optional(),
  isOutdoorPatient: z.boolean().default(true),
  visitType: z.enum(['opd', 'ipd', 'emergency']).optional(),
  prescriberId: z.number().int().positive().optional(),
  discountAmount: z.number().int().nonnegative().default(0),
  discountPct: z.number().min(0).max(100).default(0),
  vatAmount: z.number().int().nonnegative().default(0),
  paidAmount: z.number().int().nonnegative(),
  creditAmount: z.number().int().nonnegative().default(0),
  tender: z.number().int().nonnegative().default(0),
  paymentMode: z.enum(['cash', 'card', 'credit', 'mobile', 'deposit']).default('cash'),
  depositDeductAmount: z.number().int().nonnegative().default(0),
  remarks: z.string().optional(),
  items: z.array(invoiceItemSchema).min(1),
});

const invoiceReturnItemSchema = z.object({
  invoiceItemId: z.number().int().positive(),
  itemId: z.number().int().positive(),
  stockId: z.number().int().positive().optional(),
  batchNo: z.string().optional(),
  quantity: z.number().positive(),
  price: z.number().int().nonnegative(),
  discountPct: z.number().min(0).max(100).default(0),
  vatPct: z.number().min(0).max(100).default(0),
  remarks: z.string().optional(),
});

export const createInvoiceReturnSchema = z.object({
  invoiceId: z.number().int().positive(),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  remarks: z.string().optional(),
  items: z.array(invoiceReturnItemSchema).min(1),
});

// ─── Phase 4b: Supplier Return Schemas ───────────────────────────────────────

const supplierReturnItemSchema = z.object({
  itemId: z.number().int().positive(),
  stockId: z.number().int().positive().optional(),
  batchNo: z.string().optional(),
  quantity: z.number().positive(),
  itemRate: z.number().int().nonnegative(),
  discountPct: z.number().min(0).max(100).default(0),
  vatPct: z.number().min(0).max(100).default(0),
  remarks: z.string().optional(),
});

export const createSupplierReturnSchema = z.object({
  supplierId: z.number().int().positive(),
  grnId: z.number().int().positive().optional(),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  remarks: z.string().optional(),
  items: z.array(supplierReturnItemSchema).min(1),
});

// ─── Phase 5: Financial Schemas ───────────────────────────────────────────────

export const createDepositSchema = z.object({
  patientId: z.number().int().positive(),
  amount: z.number().int().positive('Deposit amount must be positive'),
  paymentMode: z.enum(['cash', 'card', 'mobile']).default('cash'),
  remarks: z.string().optional(),
});

export const createReturnDepositSchema = z.object({
  patientId: z.number().int().positive(),
  amount: z.number().int().positive(),
  paymentMode: z.enum(['cash', 'card', 'mobile']).default('cash'),
  remarks: z.string().optional(),
});

export const createSettlementSchema = z.object({
  patientId: z.number().int().positive(),
  settlementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalAmount: z.number().int().nonnegative(),
  paidAmount: z.number().int().nonnegative(),
  refundAmount: z.number().int().nonnegative().default(0),
  depositDeducted: z.number().int().nonnegative().default(0),
  paymentMode: z.enum(['cash', 'card', 'mobile']).default('cash'),
  remarks: z.string().optional(),
});

// ─── Phase 6: Advanced Schemas ────────────────────────────────────────────────

const provisionalItemSchema = z.object({
  itemId: z.number().int().positive(),
  stockId: z.number().int().positive().optional(),
  batchNo: z.string().optional(),
  expiryDate: z.string().optional(),
  quantity: z.number().positive(),
  freeQty: z.number().nonnegative().default(0),
  price: z.number().int().nonnegative(),
  salePrice: z.number().int().nonnegative(),
  discountPct: z.number().min(0).max(100).default(0),
  vatPct: z.number().min(0).max(100).default(0),
  remarks: z.string().optional(),
});

export const createProvisionalInvoiceSchema = z.object({
  patientId: z.number().int().positive(),
  patientVisitId: z.number().int().positive().optional(),
  counterId: z.number().int().positive().optional(),
  prescriberId: z.number().int().positive().optional(),
  visitType: z.enum(['inpatient', 'outpatient']).optional(),
  discountPct: z.number().min(0).max(100).default(0),
  remarks: z.string().optional(),
  items: z.array(provisionalItemSchema).min(1),
});

const prescriptionItemSchemaV2 = z.object({
  itemId: z.number().int().positive(),
  itemName: z.string().optional(),
  genericName: z.string().optional(),
  dosage: z.string().optional(),
  frequency: z.string().optional(),
  duration: z.string().optional(),
  quantity: z.number().positive(),
  route: z.string().optional(),
  instructions: z.string().optional(),
});

export const createPrescriptionSchema = z.object({
  patientId: z.number().int().positive(),
  patientVisitId: z.number().int().positive().optional(),
  prescriberId: z.number().int().positive().optional(),
  prescriberName: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(prescriptionItemSchemaV2).min(1),
});

export const createCounterSchema = z.object({
  name: z.string().min(1, 'Counter name required'),
  counterType: z.enum(['sales', 'dispensary', 'store']).default('sales'),
});

export const createNarcoticRecordSchema = z.object({
  itemId: z.number().int().positive(),
  invoiceId: z.number().int().positive().optional(),
  patientId: z.number().int().positive().optional(),
  batchNo: z.string().optional(),
  quantity: z.number().positive(),
  buyerName: z.string().optional(),
  doctorName: z.string().optional(),
  nmcNumber: z.string().optional(),
  remarks: z.string().optional(),
});

export const createWriteOffSchema = z.object({
  writeOffDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  remarks: z.string().optional(),
  items: z.array(z.object({
    stockId: z.number().int().positive(),
    itemId: z.number().int().positive(),
    batchNo: z.string().optional(),
    quantity: z.number().positive(),
    itemRate: z.number().int().nonnegative(),
    remarks: z.string().optional(),
  })).min(1),
});

const requisitionItemSchemaV2 = z.object({
  itemId: z.number().int().positive(),
  requestedQty: z.number().positive(),
  remarks: z.string().optional(),
});

export const createRequisitionSchema = z.object({
  requestingStore: z.string().optional(),
  requisitionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  remarks: z.string().optional(),
  items: z.array(requisitionItemSchemaV2).min(1),
});

const dispatchItemSchemaV2 = z.object({
  requisitionItemId: z.number().int().positive().optional(),
  itemId: z.number().int().positive(),
  stockId: z.number().int().positive().optional(),
  batchNo: z.string().min(1),
  expiryDate: z.string().optional(),
  dispatchedQty: z.number().positive(),
  costPrice: z.number().int().nonnegative(),
  salePrice: z.number().int().nonnegative(),
  remarks: z.string().optional(),
});

export const createDispatchSchema = z.object({
  requisitionId: z.number().int().positive().optional(),
  sourceStore: z.string().optional(),
  targetStore: z.string().optional(),
  dispatchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  receivedBy: z.string().optional(),
  remarks: z.string().optional(),
  items: z.array(dispatchItemSchemaV2).min(1),
});

// ─── Type Exports ──────────────────────────────────────────────────────────────

export type CreateMedicineInput           = z.infer<typeof createMedicineSchema>;
export type CreateSupplierInput           = z.infer<typeof createSupplierSchema>;
export type CreatePurchaseInput           = z.infer<typeof createPurchaseSchema>;
export type CreateSaleInput               = z.infer<typeof createSaleSchema>;
export type CreatePharmacyBillInput       = z.infer<typeof createPharmacyBillSchema>;
export type CreateCategoryInput           = z.infer<typeof createCategorySchema>;
export type CreateGenericInput            = z.infer<typeof createGenericSchema>;
export type CreatePharmacySupplierInput   = z.infer<typeof createPharmacySupplierSchema>;
export type CreateUOMInput                = z.infer<typeof createUOMSchema>;
export type CreatePackingTypeInput        = z.infer<typeof createPackingTypeSchema>;
export type CreateRackInput               = z.infer<typeof createRackSchema>;
export type CreatePharmacyItemInput       = z.infer<typeof createPharmacyItemSchema>;
export type CreatePurchaseOrderInput      = z.infer<typeof createPurchaseOrderSchema>;
export type CreateGoodsReceiptInput       = z.infer<typeof createGoodsReceiptSchema>;
export type StockAdjustmentInput          = z.infer<typeof stockAdjustmentSchema>;
export type CreateInvoiceInput            = z.infer<typeof createInvoiceSchema>;
export type CreateInvoiceReturnInput      = z.infer<typeof createInvoiceReturnSchema>;
export type CreateSupplierReturnInput     = z.infer<typeof createSupplierReturnSchema>;
export type CreateDepositInput            = z.infer<typeof createDepositSchema>;
export type CreateSettlementInput         = z.infer<typeof createSettlementSchema>;
export type CreateProvisionalInvoiceInput = z.infer<typeof createProvisionalInvoiceSchema>;
export type CreatePrescriptionInput       = z.infer<typeof createPrescriptionSchema>;
export type CreateCounterInput            = z.infer<typeof createCounterSchema>;
export type CreateNarcoticRecordInput     = z.infer<typeof createNarcoticRecordSchema>;
export type CreateWriteOffInput           = z.infer<typeof createWriteOffSchema>;
export type CreateRequisitionInput        = z.infer<typeof createRequisitionSchema>;
export type CreateDispatchInput           = z.infer<typeof createDispatchSchema>;

// ─── PHASE 2/3 SCHEMAS ─────────────────────────────────────────────────

export const createTaxConfigSchema = z.object({
  tax_name:  z.string().min(1, 'Tax name is required'),
  tax_rate:  z.number().min(0),
  tax_type:  z.enum(['percentage', 'flat']).default('percentage'),
  is_active: z.number().int().min(0).max(1).default(1),
});

export const updateTaxConfigSchema = createTaxConfigSchema.partial();

export const createPriceHistorySchema = z.object({
  new_mrp:        z.number().int().min(0, 'MRP must be ≥0 (paisa)'),
  new_cost_price: z.number().int().min(0, 'Cost must be ≥0 (paisa)'),
  batch_no:       z.string().optional(),
  old_mrp:        z.number().int().optional(),
  old_cost_price: z.number().int().optional(),
  change_reason:  z.string().optional(),
});

export const barcodeSchema = z.object({
  barcode: z.string().min(1, 'Barcode is required').max(128),
});

export const createDosageTemplateSchema = z.object({
  generic_id:    z.number().int().positive().optional(),
  dosage_label:  z.string().min(1, 'Dosage label is required'),
  frequency:     z.string().min(1, 'Frequency is required'),
  route:         z.string().default('Oral'),
  duration_days: z.number().int().positive().optional(),
  notes:         z.string().optional(),
});

export const updateDosageTemplateSchema = createDosageTemplateSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export const approvalActionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  notes:  z.string().optional(),
}).refine(
  (d) => d.action !== 'reject' || (d.notes && d.notes.trim().length > 0),
  { message: 'Rejection notes are required', path: ['notes'] }
);

export const itemTypeSchema = z.object({
  item_type:   z.string().optional(),
  is_narcotic: z.boolean().optional(),
});

// ─── PHASE 7: Stock Adjustment Approval + Idempotency ─────────────────────────

/** Stock adjustments that must be queued for supervisor approval. */
export const stockAdjustmentRequestSchema = z.object({
  stockId: z.number().int().positive(),
  itemId: z.number().int().positive(),
  adjustmentType: z.enum(['in', 'out']),
  quantity: z.number().positive(),
  amountImpact: z.number().int().nonnegative().default(0), // paisa — estimated value of adjustment
  isNarcotic: z.boolean().default(false),
  remarks: z.string().min(1, 'Adjustment reason required'),
  /** When true, the request is queued for supervisor approval and the stock change is NOT applied yet. */
  deferApply: z.boolean().default(false),
});

/** Approve / reject a queued stock adjustment. */
export const reviewStockAdjustmentSchema = z.object({
  action: z.enum(['approve', 'reject']),
  notes: z.string().optional(),
}).refine(
  (d) => d.action !== 'reject' || (d.notes && d.notes.trim().length > 0),
  { message: 'Rejection notes are required', path: ['notes'] },
);

/** Threshold (in paisa) above which stock adjustment is always queued for approval. */
export const STOCK_ADJUSTMENT_APPROVAL_THRESHOLD_PAISA = 5000 * 100; // 5,000 BDT in paisa

// ─── PHASE 7: Idempotency-key helpers for invoice/return/purchase/GRN ────────

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8, 'Idempotency key must be at least 8 characters')
  .max(128, 'Idempotency key must be at most 128 characters');

// ─── PHASE 7: Repairable finalization (used by /invoices/:id/repair) ─────────

export const invoiceRepairSchema = z.object({
  notes: z.string().min(1, 'Repair notes required'),
  forceFinalize: z.boolean().default(false),
});
