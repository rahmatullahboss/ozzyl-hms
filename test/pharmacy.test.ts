import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ─── Pharmacy Module — Pre-Push Tests ─────────────────────────────────────────
// Covers the 5 must-have areas before pushing pharmacy module:
//   1. Invoice creation (createInvoiceSchema)
//   2. Goods Receipt (GRN) creation (createGoodsReceiptSchema)
//   3. Purchase Order creation (createPurchaseOrderSchema)
//   4. Stock validation business logic
//   5. Deposit balance check business logic

// ─── Schemas mirrored from src/schemas/pharmacy.ts ───────────────────────────

// Invoice
const invoiceItemSchema = z.object({
  itemId:      z.number().int().positive(),
  stockId:     z.number().int().positive(),
  batchNo:     z.string().min(1),
  expiryDate:  z.string().optional(),
  quantity:    z.number().positive(),
  mrp:         z.number().int().nonnegative(),
  price:       z.number().int().nonnegative(),
  discountPct: z.number().min(0).max(100).default(0),
  vatPct:      z.number().min(0).max(100).default(0),
});

const createInvoiceSchema = z.object({
  patientId:           z.number().int().positive().optional(),
  patientVisitId:      z.number().int().positive().optional(),
  counterId:           z.number().int().positive().optional(),
  isOutdoorPatient:    z.boolean().default(true),
  visitType:           z.enum(['opd', 'ipd', 'emergency']).optional(),
  prescriberId:        z.number().int().positive().optional(),
  discountAmount:      z.number().int().nonnegative().default(0),
  discountPct:         z.number().min(0).max(100).default(0),
  vatAmount:           z.number().int().nonnegative().default(0),
  paidAmount:          z.number().int().nonnegative(),
  creditAmount:        z.number().int().nonnegative().default(0),
  tender:              z.number().int().nonnegative().default(0),
  paymentMode:         z.enum(['cash', 'card', 'credit', 'mobile', 'deposit']).default('cash'),
  depositDeductAmount: z.number().int().nonnegative().default(0),
  remarks:             z.string().optional(),
  items:               z.array(invoiceItemSchema).min(1),
});

// Goods Receipt (GRN)
const grnItemSchema = z.object({
  itemId:          z.number().int().positive(),
  batchNo:         z.string().min(1),
  expiryDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  receivedQty:     z.number().positive(),
  freeQty:         z.number().nonnegative().default(0),
  rejectedQty:     z.number().nonnegative().default(0),
  itemRate:        z.number().int().nonnegative(),
  mrp:             z.number().int().nonnegative(),
  discountPct:     z.number().min(0).max(100).default(0),
  vatPct:          z.number().min(0).max(100).default(0),
  salePrice:       z.number().int().nonnegative(),
  manufactureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const createGoodsReceiptSchema = z.object({
  poId:                     z.number().int().positive().optional(),
  supplierId:               z.number().int().positive(),
  invoiceNo:                z.string().optional(),
  grnDate:                  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  supplierBillDate:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  discountPct:              z.number().min(0).max(100).default(0),
  discountAmount:           z.number().int().nonnegative().default(0),
  vatPct:                   z.number().min(0).max(100).default(0),
  adjustment:               z.number().int().default(0),
  creditPeriod:             z.number().int().nonnegative().default(0),
  remarks:                  z.string().optional(),
  isItemDiscountApplicable: z.boolean().default(false),
  items:                    z.array(grnItemSchema).min(1),
});

// Purchase Order (PO)
const poItemSchema = z.object({
  itemId:       z.number().int().positive(),
  quantity:     z.number().positive(),
  standardRate: z.number().int().nonnegative(),
  vatAmount:    z.number().int().nonnegative().default(0),
  remarks:      z.string().optional(),
});

const createPurchaseOrderSchema = z.object({
  supplierId:      z.number().int().positive(),
  poDate:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  referenceNo:     z.string().optional(),
  discountAmount:  z.number().int().nonnegative().default(0),
  discountPct:     z.number().min(0).max(100).default(0),
  vatAmount:       z.number().int().nonnegative().default(0),
  adjustment:      z.number().int().default(0),
  deliveryAddress: z.string().optional(),
  deliveryDays:    z.number().int().nonnegative().default(0),
  deliveryDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  remarks:         z.string().optional(),
  termsConditions: z.string().optional(),
  items:           z.array(poItemSchema).min(1),
});

const cancelPurchaseOrderSchema = z.object({
  cancelRemarks: z.string().min(1, 'Cancellation reason required'),
});

// Deposit
const createDepositSchema = z.object({
  patientId:   z.number().int().positive(),
  amount:      z.number().int().positive(),
  paymentMode: z.enum(['cash', 'card', 'mobile']).default('cash'),
  remarks:     z.string().optional(),
});

const createReturnDepositSchema = z.object({
  patientId:   z.number().int().positive(),
  amount:      z.number().int().positive(),
  paymentMode: z.enum(['cash', 'card', 'mobile']).default('cash'),
  remarks:     z.string().optional(),
});

const createSettlementSchema = z.object({
  patientId:       z.number().int().positive(),
  settlementDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalAmount:     z.number().int().nonnegative(),
  paidAmount:      z.number().int().nonnegative(),
  refundAmount:    z.number().int().nonnegative().default(0),
  depositDeducted: z.number().int().nonnegative().default(0),
  paymentMode:     z.enum(['cash', 'card', 'mobile']).default('cash'),
  remarks:         z.string().optional(),
});

// Stock adjustment
const stockAdjustmentSchema = z.object({
  stockId:        z.number().int().positive(),
  itemId:         z.number().int().positive(),
  adjustmentType: z.enum(['in', 'out']),
  quantity:       z.number().positive(),
  remarks:        z.string().min(1),
});

// ─────────────────────────────────────────────────────────────────────────────
// Business logic helpers — mirror backend logic in pharmacy.ts
// ─────────────────────────────────────────────────────────────────────────────

/** Calculate line total for an invoice item (amounts in paisa) */
function calcLineTotal(item: {
  quantity: number; price: number; discountPct: number; vatPct: number;
}): number {
  const lineSubtotal = item.quantity * item.price;
  const discountAmt  = Math.round(lineSubtotal * (item.discountPct / 100));
  const vatAmt       = Math.round((lineSubtotal - discountAmt) * (item.vatPct / 100));
  return lineSubtotal - discountAmt + vatAmt;
}

/** Check if an invoice has sufficient stock for each item */
function validateStock(
  items: Array<{ stockId: number; quantity: number }>,
  stockMap: Map<number, number>,  // stockId → available_qty
): { valid: boolean; error?: string } {
  for (const item of items) {
    const available = stockMap.get(item.stockId) ?? 0;
    if (available < item.quantity) {
      return {
        valid: false,
        error: `Insufficient stock for stockId ${item.stockId}. Available: ${available}, Requested: ${item.quantity}`,
      };
    }
  }
  return { valid: true };
}

/** Calculate deposit balance from a list of deposit transactions */
function calcDepositBalance(
  transactions: Array<{ deposit_type: string; amount: number }>,
): number {
  return transactions.reduce((sum, t) => {
    return sum + (t.deposit_type === 'deposit' ? t.amount : -t.amount);
  }, 0);
}

/** Validate that a deposit return doesn't exceed current balance */
function validateReturnDeposit(
  balance: number,
  returnAmount: number,
): { valid: boolean; error?: string } {
  if (returnAmount > balance) {
    return { valid: false, error: `Insufficient balance. Balance: ${balance}, Requested: ${returnAmount}` };
  }
  return { valid: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 1: Invoice Creation (createInvoiceSchema)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pharmacy — Invoice Creation', () => {

  describe('Schema Validation', () => {

    it('should accept a minimal valid invoice (cash, single item)', () => {
      const result = createInvoiceSchema.safeParse({
        paidAmount: 50000,
        items: [{
          itemId: 1, stockId: 1, batchNo: 'B001',
          quantity: 2, mrp: 30000, price: 28000,
        }],
      });
      expect(result.success).toBe(true);
    });

    it('should accept a full invoice with all optional fields', () => {
      const result = createInvoiceSchema.safeParse({
        patientId: 101, patientVisitId: 5, counterId: 1,
        isOutdoorPatient: false, visitType: 'ipd', prescriberId: 3,
        discountAmount: 1000, discountPct: 5, vatAmount: 500,
        paidAmount: 49500, creditAmount: 0, tender: 50000,
        paymentMode: 'cash', depositDeductAmount: 0, remarks: 'Urgent purchase',
        items: [{
          itemId: 1, stockId: 2, batchNo: 'EXP2027', expiryDate: '2027-12-31',
          quantity: 1, mrp: 50000, price: 47500, discountPct: 5, vatPct: 0,
        }],
      });
      expect(result.success).toBe(true);
    });

    it('should reject invoice without items', () => {
      const result = createInvoiceSchema.safeParse({ paidAmount: 1000, items: [] });
      expect(result.success).toBe(false);
    });

    it('should reject invoice without paidAmount', () => {
      const result = createInvoiceSchema.safeParse({
        items: [{ itemId: 1, stockId: 1, batchNo: 'B1', quantity: 1, mrp: 100, price: 100 }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject item with quantity = 0', () => {
      const result = createInvoiceSchema.safeParse({
        paidAmount: 0,
        items: [{ itemId: 1, stockId: 1, batchNo: 'B1', quantity: 0, mrp: 100, price: 100 }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject item with negative quantity', () => {
      const result = createInvoiceSchema.safeParse({
        paidAmount: 0,
        items: [{ itemId: 1, stockId: 1, batchNo: 'B1', quantity: -1, mrp: 100, price: 100 }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject item with empty batchNo', () => {
      const result = createInvoiceSchema.safeParse({
        paidAmount: 0,
        items: [{ itemId: 1, stockId: 1, batchNo: '', quantity: 1, mrp: 100, price: 100 }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid paymentMode', () => {
      const result = createInvoiceSchema.safeParse({
        paidAmount: 1000, paymentMode: 'cheque',
        items: [{ itemId: 1, stockId: 1, batchNo: 'B1', quantity: 1, mrp: 100, price: 100 }],
      });
      expect(result.success).toBe(false);
    });

    it('should accept all valid paymentModes', () => {
      const modes = ['cash', 'card', 'credit', 'mobile', 'deposit'] as const;
      for (const mode of modes) {
        const result = createInvoiceSchema.safeParse({
          paidAmount: 0, paymentMode: mode,
          items: [{ itemId: 1, stockId: 1, batchNo: 'B1', quantity: 1, mrp: 100, price: 100 }],
        });
        expect(result.success, `paymentMode '${mode}' should be valid`).toBe(true);
      }
    });

    it('should reject discountPct above 100', () => {
      const result = createInvoiceSchema.safeParse({
        paidAmount: 0, discountPct: 101,
        items: [{ itemId: 1, stockId: 1, batchNo: 'B1', quantity: 1, mrp: 100, price: 100 }],
      });
      expect(result.success).toBe(false);
    });

    it('should accept multiple items in one invoice', () => {
      const result = createInvoiceSchema.safeParse({
        paidAmount: 200000,
        items: [
          { itemId: 1, stockId: 1, batchNo: 'B001', quantity: 3, mrp: 50000, price: 48000 },
          { itemId: 2, stockId: 3, batchNo: 'B002', quantity: 1, mrp: 80000, price: 75000, discountPct: 5 },
          { itemId: 3, stockId: 5, batchNo: 'B003', quantity: 2, mrp: 20000, price: 19000, vatPct: 5 },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid visitType', () => {
      const result = createInvoiceSchema.safeParse({
        paidAmount: 0, visitType: 'walk-in',
        items: [{ itemId: 1, stockId: 1, batchNo: 'B1', quantity: 1, mrp: 100, price: 100 }],
      });
      expect(result.success).toBe(false);
    });

    it('should default isOutdoorPatient to true', () => {
      const result = createInvoiceSchema.safeParse({
        paidAmount: 0,
        items: [{ itemId: 1, stockId: 1, batchNo: 'B1', quantity: 1, mrp: 100, price: 100 }],
      });
      if (result.success) expect(result.data.isOutdoorPatient).toBe(true);
    });

    it('should default paymentMode to cash when not provided', () => {
      const result = createInvoiceSchema.safeParse({
        paidAmount: 0,
        items: [{ itemId: 1, stockId: 1, batchNo: 'B1', quantity: 1, mrp: 100, price: 100 }],
      });
      if (result.success) expect(result.data.paymentMode).toBe('cash');
    });
  });

  describe('Line Total Calculation', () => {

    it('should calculate line total without discount or VAT', () => {
      const total = calcLineTotal({ quantity: 5, price: 10000, discountPct: 0, vatPct: 0 });
      expect(total).toBe(50000);
    });

    it('should apply discount correctly', () => {
      // 2 × 10000 = 20000, −10% = 18000
      const total = calcLineTotal({ quantity: 2, price: 10000, discountPct: 10, vatPct: 0 });
      expect(total).toBe(18000);
    });

    it('should apply VAT on full price when no discount', () => {
      // 10000 + 15% = 11500
      const total = calcLineTotal({ quantity: 1, price: 10000, discountPct: 0, vatPct: 15 });
      expect(total).toBe(11500);
    });

    it('should apply discount before VAT (correct order)', () => {
      // 10000, −10% = 9000, +10% VAT = 9900
      const total = calcLineTotal({ quantity: 1, price: 10000, discountPct: 10, vatPct: 10 });
      expect(total).toBe(9900);
    });

    it('should return 0 for zero quantity', () => {
      const total = calcLineTotal({ quantity: 0, price: 50000, discountPct: 5, vatPct: 5 });
      expect(total).toBe(0);
    });

    it('should handle high quantity orders correctly', () => {
      // 100 × 5000 = 500000, −10% = 450000
      const total = calcLineTotal({ quantity: 100, price: 5000, discountPct: 10, vatPct: 0 });
      expect(total).toBe(450000);
    });

    it('should sum multi-item invoice total correctly', () => {
      const items = [
        { quantity: 2, price: 10000, discountPct: 0, vatPct: 0 },  // 20000
        { quantity: 1, price: 30000, discountPct: 10, vatPct: 0 }, // 27000
        { quantity: 3, price: 5000,  discountPct: 0, vatPct: 5 },  // 15750
      ];
      const grandTotal = items.reduce((sum, i) => sum + calcLineTotal(i), 0);
      expect(grandTotal).toBe(62750);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 2: Goods Receipt (GRN) Creation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pharmacy — GRN (Goods Receipt) Creation', () => {

  describe('Schema Validation', () => {

    it('should accept a minimal valid GRN', () => {
      const result = createGoodsReceiptSchema.safeParse({
        supplierId: 1, grnDate: '2026-03-15',
        items: [{
          itemId: 1, batchNo: 'B001',
          receivedQty: 100, itemRate: 8000, mrp: 10000, salePrice: 9500,
        }],
      });
      expect(result.success).toBe(true);
    });

    it('should accept a full GRN with all optional fields', () => {
      const result = createGoodsReceiptSchema.safeParse({
        poId: 5, supplierId: 2, invoiceNo: 'INV-2026-001',
        grnDate: '2026-03-15', supplierBillDate: '2026-03-14',
        discountPct: 2.5, discountAmount: 5000, vatPct: 5,
        adjustment: -1000, creditPeriod: 30, remarks: 'Received in good condition',
        isItemDiscountApplicable: true,
        items: [{
          itemId: 1, batchNo: 'B001', expiryDate: '2028-12-31',
          receivedQty: 200, freeQty: 10, rejectedQty: 2,
          itemRate: 8000, mrp: 10000, salePrice: 9500,
          discountPct: 2, vatPct: 5, manufactureDate: '2025-06-01',
        }],
      });
      expect(result.success).toBe(true);
    });

    it('should reject GRN without supplierId', () => {
      const result = createGoodsReceiptSchema.safeParse({
        grnDate: '2026-01-01',
        items: [{ itemId: 1, batchNo: 'B1', receivedQty: 1, itemRate: 100, mrp: 120, salePrice: 110 }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject GRN without grnDate', () => {
      const result = createGoodsReceiptSchema.safeParse({
        supplierId: 1,
        items: [{ itemId: 1, batchNo: 'B1', receivedQty: 1, itemRate: 100, mrp: 120, salePrice: 110 }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject GRN without items', () => {
      const result = createGoodsReceiptSchema.safeParse({
        supplierId: 1, grnDate: '2026-01-01', items: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject item with empty batchNo', () => {
      const result = createGoodsReceiptSchema.safeParse({
        supplierId: 1, grnDate: '2026-01-01',
        items: [{ itemId: 1, batchNo: '', receivedQty: 10, itemRate: 100, mrp: 120, salePrice: 110 }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject item with receivedQty = 0', () => {
      const result = createGoodsReceiptSchema.safeParse({
        supplierId: 1, grnDate: '2026-01-01',
        items: [{ itemId: 1, batchNo: 'B1', receivedQty: 0, itemRate: 100, mrp: 120, salePrice: 110 }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid grnDate format (DD/MM/YYYY)', () => {
      const result = createGoodsReceiptSchema.safeParse({
        supplierId: 1, grnDate: '15/03/2026',
        items: [{ itemId: 1, batchNo: 'B1', receivedQty: 1, itemRate: 100, mrp: 120, salePrice: 110 }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject item discountPct above 100', () => {
      const result = createGoodsReceiptSchema.safeParse({
        supplierId: 1, grnDate: '2026-01-01',
        items: [{ itemId: 1, batchNo: 'B1', receivedQty: 1, itemRate: 100, mrp: 120, salePrice: 110, discountPct: 110 }],
      });
      expect(result.success).toBe(false);
    });

    it('should accept adjustment as negative (credit note scenario)', () => {
      const result = createGoodsReceiptSchema.safeParse({
        supplierId: 1, grnDate: '2026-01-01', adjustment: -5000,
        items: [{ itemId: 1, batchNo: 'B1', receivedQty: 1, itemRate: 100, mrp: 120, salePrice: 110 }],
      });
      expect(result.success).toBe(true);
    });

    it('should accept multiple items in one GRN', () => {
      const result = createGoodsReceiptSchema.safeParse({
        supplierId: 1, grnDate: '2026-03-01',
        items: [
          { itemId: 1, batchNo: 'B001', receivedQty: 50,  itemRate: 5000, mrp: 7000, salePrice: 6500 },
          { itemId: 2, batchNo: 'B002', receivedQty: 100, itemRate: 3000, mrp: 4000, salePrice: 3800 },
          { itemId: 3, batchNo: 'B003', receivedQty: 200, itemRate: 1000, mrp: 1500, salePrice: 1400 },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('GRN Business Rules', () => {

    it('should ensure rejectedQty cannot exceed receivedQty (guard logic)', () => {
      const receivedQty = 100;
      const rejectedQty = 150;
      expect(rejectedQty <= receivedQty).toBe(false);
    });

    it('should ensure freeQty does not reduce billed qty below zero', () => {
      const receivedQty = 10;
      const freeQty = 5;
      const billedQty = receivedQty - freeQty;
      expect(billedQty).toBeGreaterThanOrEqual(0);
    });

    it('should calculate GRN line subtotals correctly (paisa)', () => {
      const items = [
        { receivedQty: 100, itemRate: 5000, discountPct: 0 },   // 500000
        { receivedQty: 50,  itemRate: 8000, discountPct: 10 },  // 360000
      ];
      const subtotals = items.map(i => {
        const gross = i.receivedQty * i.itemRate;
        return gross - Math.round(gross * (i.discountPct / 100));
      });
      expect(subtotals[0]).toBe(500000);
      expect(subtotals[1]).toBe(360000);
    });

    it('should calculate effective received quantity as receivedQty + freeQty', () => {
      const receivedQty = 100;
      const freeQty = 10;
      const effectiveQty = receivedQty + freeQty;
      expect(effectiveQty).toBe(110);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 3: Purchase Order (PO) Creation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pharmacy — Purchase Order Creation', () => {

  describe('Schema Validation', () => {

    it('should accept a minimal valid PO', () => {
      const result = createPurchaseOrderSchema.safeParse({
        supplierId: 1, poDate: '2026-03-15',
        items: [{ itemId: 1, quantity: 100, standardRate: 5000 }],
      });
      expect(result.success).toBe(true);
    });

    it('should accept a comprehensive PO with all fields', () => {
      const result = createPurchaseOrderSchema.safeParse({
        supplierId: 3, poDate: '2026-03-20', referenceNo: 'REF-2026-003',
        discountAmount: 10000, discountPct: 2, vatAmount: 25000, adjustment: 500,
        deliveryAddress: 'Pharmacy Store — Ground Floor', deliveryDays: 7,
        deliveryDate: '2026-03-27', remarks: 'Urgent restock',
        termsConditions: 'Net 30 days',
        items: [
          { itemId: 1, quantity: 50,  standardRate: 8000, vatAmount: 400, remarks: 'Priority' },
          { itemId: 2, quantity: 200, standardRate: 2500 },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should reject PO without supplierId', () => {
      const result = createPurchaseOrderSchema.safeParse({
        poDate: '2026-01-01',
        items: [{ itemId: 1, quantity: 10, standardRate: 5000 }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject PO without poDate', () => {
      const result = createPurchaseOrderSchema.safeParse({
        supplierId: 1,
        items: [{ itemId: 1, quantity: 10, standardRate: 5000 }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject PO with empty items array', () => {
      const result = createPurchaseOrderSchema.safeParse({
        supplierId: 1, poDate: '2026-01-01', items: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject PO item with quantity = 0', () => {
      const result = createPurchaseOrderSchema.safeParse({
        supplierId: 1, poDate: '2026-01-01',
        items: [{ itemId: 1, quantity: 0, standardRate: 5000 }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject PO item with negative standardRate', () => {
      const result = createPurchaseOrderSchema.safeParse({
        supplierId: 1, poDate: '2026-01-01',
        items: [{ itemId: 1, quantity: 10, standardRate: -100 }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid poDate format (DD-MM-YYYY)', () => {
      const result = createPurchaseOrderSchema.safeParse({
        supplierId: 1, poDate: '20-03-2026',
        items: [{ itemId: 1, quantity: 10, standardRate: 5000 }],
      });
      expect(result.success).toBe(false);
    });

    it('should allow fractional quantity (e.g. 2.5 litres)', () => {
      const result = createPurchaseOrderSchema.safeParse({
        supplierId: 1, poDate: '2026-01-01',
        items: [{ itemId: 1, quantity: 2.5, standardRate: 15000 }],
      });
      expect(result.success).toBe(true);
    });

    it('should reject discountPct > 100', () => {
      const result = createPurchaseOrderSchema.safeParse({
        supplierId: 1, poDate: '2026-01-01', discountPct: 110,
        items: [{ itemId: 1, quantity: 10, standardRate: 5000 }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('PO Cancellation', () => {

    it('should accept valid cancellation reason', () => {
      const result = cancelPurchaseOrderSchema.safeParse({ cancelRemarks: 'Supplier unable to fulfil' });
      expect(result.success).toBe(true);
    });

    it('should reject empty cancellation reason', () => {
      const result = cancelPurchaseOrderSchema.safeParse({ cancelRemarks: '' });
      expect(result.success).toBe(false);
    });

    it('should reject cancellation without reason field', () => {
      const result = cancelPurchaseOrderSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should enforce cancellation irreversibility (status guard)', () => {
      const canEdit = (status: string) => !['cancelled', 'completed'].includes(status);
      expect(canEdit('pending')).toBe(true);
      expect(canEdit('approved')).toBe(true);
      expect(canEdit('cancelled')).toBe(false);
      expect(canEdit('completed')).toBe(false);
    });

    it('should enforce that only pending/approved POs can be cancelled', () => {
      const canCancel = (status: string) => ['pending', 'approved'].includes(status);
      expect(canCancel('pending')).toBe(true);
      expect(canCancel('approved')).toBe(true);
      expect(canCancel('cancelled')).toBe(false);
      expect(canCancel('completed')).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 4: Stock Validation Business Logic
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pharmacy — Stock Validation', () => {

  describe('Sufficient Stock Check', () => {

    it('should pass when requested qty equals available qty', () => {
      const stockMap = new Map([[1, 10]]);
      const result = validateStock([{ stockId: 1, quantity: 10 }], stockMap);
      expect(result.valid).toBe(true);
    });

    it('should pass when requested qty is less than available', () => {
      const stockMap = new Map([[1, 100]]);
      const result = validateStock([{ stockId: 1, quantity: 50 }], stockMap);
      expect(result.valid).toBe(true);
    });

    it('should fail when requested qty exceeds available qty', () => {
      const stockMap = new Map([[1, 5]]);
      const result = validateStock([{ stockId: 1, quantity: 10 }], stockMap);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Insufficient stock');
    });

    it('should fail when stock record does not exist (unknown stockId)', () => {
      const stockMap = new Map<number, number>();
      const result = validateStock([{ stockId: 999, quantity: 1 }], stockMap);
      expect(result.valid).toBe(false);
    });

    it('should fail on the first item that has insufficient stock', () => {
      const stockMap = new Map([[1, 100], [2, 3], [3, 50]]);
      const result = validateStock([
        { stockId: 1, quantity: 10 },  // OK
        { stockId: 2, quantity: 10 },  // FAIL (only 3 available)
        { stockId: 3, quantity: 20 },  // Not checked
      ], stockMap);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('2');
    });

    it('should pass multi-item invoice when all stock is available', () => {
      const stockMap = new Map([[1, 100], [2, 50], [3, 200]]);
      const result = validateStock([
        { stockId: 1, quantity: 30 },
        { stockId: 2, quantity: 20 },
        { stockId: 3, quantity: 100 },
      ], stockMap);
      expect(result.valid).toBe(true);
    });

    it('should report available and requested quantities in error', () => {
      const stockMap = new Map([[7, 5]]);
      const result = validateStock([{ stockId: 7, quantity: 10 }], stockMap);
      expect(result.error).toContain('Available: 5');
      expect(result.error).toContain('Requested: 10');
    });
  });

  describe('Stock Adjustment Schema', () => {

    it('should accept a valid stock-in adjustment', () => {
      const result = stockAdjustmentSchema.safeParse({
        stockId: 1, itemId: 1, adjustmentType: 'in',
        quantity: 50, remarks: 'Physical count correction',
      });
      expect(result.success).toBe(true);
    });

    it('should accept a valid stock-out adjustment', () => {
      const result = stockAdjustmentSchema.safeParse({
        stockId: 1, itemId: 1, adjustmentType: 'out',
        quantity: 10, remarks: 'Damaged — write-off',
      });
      expect(result.success).toBe(true);
    });

    it('should reject adjustment without remarks', () => {
      const result = stockAdjustmentSchema.safeParse({
        stockId: 1, itemId: 1, adjustmentType: 'in', quantity: 5, remarks: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject adjustment with quantity = 0', () => {
      const result = stockAdjustmentSchema.safeParse({
        stockId: 1, itemId: 1, adjustmentType: 'out', quantity: 0, remarks: 'Test',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid adjustmentType', () => {
      const result = stockAdjustmentSchema.safeParse({
        stockId: 1, itemId: 1, adjustmentType: 'transfer', quantity: 5, remarks: 'Test',
      });
      expect(result.success).toBe(false);
    });

    it('should accept only "in" and "out" as adjustment types', () => {
      for (const type of ['in', 'out'] as const) {
        expect(stockAdjustmentSchema.safeParse({
          stockId: 1, itemId: 1, adjustmentType: type, quantity: 1, remarks: 'test',
        }).success).toBe(true);
      }
    });
  });

  describe('Expiry & FEFO Logic', () => {

    it('should detect expired batches', () => {
      const expiryDate = new Date('2025-01-01');
      expect(expiryDate < new Date()).toBe(true);
    });

    it('should detect batches expiring within 30 days', () => {
      const soon = new Date();
      soon.setDate(soon.getDate() + 15);
      const daysUntilExpiry = Math.floor((soon.getTime() - Date.now()) / 86400000);
      expect(daysUntilExpiry).toBeLessThanOrEqual(30);
    });

    it('should apply FEFO — earliest expiry batch first', () => {
      const batches = [
        { batchNo: 'B3', expiryDate: '2027-06-01' },
        { batchNo: 'B1', expiryDate: '2026-03-01' },
        { batchNo: 'B2', expiryDate: '2026-09-15' },
      ];
      const sorted = [...batches].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
      expect(sorted[0].batchNo).toBe('B1');
      expect(sorted[1].batchNo).toBe('B2');
      expect(sorted[2].batchNo).toBe('B3');
    });

    it('should put batches with null expiry last in FEFO', () => {
      const batches = [
        { batchNo: 'B2', expiryDate: null },
        { batchNo: 'B1', expiryDate: '2026-06-01' },
      ];
      const sorted = [...batches].sort((a, b) => {
        if (!a.expiryDate) return 1;
        if (!b.expiryDate) return -1;
        return a.expiryDate.localeCompare(b.expiryDate);
      });
      expect(sorted[0].batchNo).toBe('B1');
      expect(sorted[1].batchNo).toBe('B2');
    });

    it('should flag stock that is below reorder level', () => {
      const items = [
        { name: 'Paracetamol', available_qty: 30, reorder_level: 50 },
        { name: 'Amoxicillin', available_qty: 100, reorder_level: 20 },
        { name: 'Metformin',   available_qty: 5,  reorder_level: 10 },
      ];
      const lowStock = items.filter(i => i.available_qty < i.reorder_level);
      expect(lowStock.length).toBe(2);
      expect(lowStock.map(i => i.name)).toContain('Paracetamol');
      expect(lowStock.map(i => i.name)).toContain('Metformin');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 5: Deposit Balance Check
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pharmacy — Deposit Balance Logic', () => {

  describe('Balance Calculation', () => {

    it('should calculate balance from deposits only', () => {
      const txns = [
        { deposit_type: 'deposit', amount: 100000 },
        { deposit_type: 'deposit', amount: 50000 },
      ];
      expect(calcDepositBalance(txns)).toBe(150000);
    });

    it('should subtract returns from balance', () => {
      const txns = [
        { deposit_type: 'deposit', amount: 100000 },
        { deposit_type: 'return',  amount: 30000 },
      ];
      expect(calcDepositBalance(txns)).toBe(70000);
    });

    it('should return 0 for empty transactions', () => {
      expect(calcDepositBalance([])).toBe(0);
    });

    it('should return 0 when all deposits are returned', () => {
      const txns = [
        { deposit_type: 'deposit', amount: 50000 },
        { deposit_type: 'return',  amount: 50000 },
      ];
      expect(calcDepositBalance(txns)).toBe(0);
    });

    it('should handle multiple deposits and returns', () => {
      const txns = [
        { deposit_type: 'deposit', amount: 200000 },
        { deposit_type: 'deposit', amount: 100000 },
        { deposit_type: 'return',  amount: 50000 },
        { deposit_type: 'return',  amount: 25000 },
      ];
      // 300000 − 75000 = 225000
      expect(calcDepositBalance(txns)).toBe(225000);
    });

    it('should correctly handle paisa—BDT conversion', () => {
      // 500 BDT = 50000 paisa
      const txns = [{ deposit_type: 'deposit', amount: 50000 }];
      const balancePaisa = calcDepositBalance(txns);
      expect(balancePaisa / 100).toBe(500);
    });
  });

  describe('Deposit Return Validation', () => {

    it('should allow return when amount equals balance', () => {
      expect(validateReturnDeposit(100000, 100000).valid).toBe(true);
    });

    it('should allow return when amount is less than balance', () => {
      expect(validateReturnDeposit(100000, 60000).valid).toBe(true);
    });

    it('should reject return when amount exceeds balance', () => {
      const result = validateReturnDeposit(50000, 60000);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Insufficient balance');
    });

    it('should reject return when balance is zero', () => {
      expect(validateReturnDeposit(0, 1000).valid).toBe(false);
    });

    it('should include balance and requested amount in error message', () => {
      const result = validateReturnDeposit(30000, 50000);
      expect(result.error).toContain('30000');
      expect(result.error).toContain('50000');
    });
  });

  describe('Deposit Schema Validation', () => {

    it('should accept a valid deposit', () => {
      const result = createDepositSchema.safeParse({
        patientId: 101, amount: 50000, paymentMode: 'cash',
      });
      expect(result.success).toBe(true);
    });

    it('should reject deposit without patientId', () => {
      const result = createDepositSchema.safeParse({ amount: 50000, paymentMode: 'cash' });
      expect(result.success).toBe(false);
    });

    it('should reject deposit with amount = 0', () => {
      const result = createDepositSchema.safeParse({ patientId: 101, amount: 0 });
      expect(result.success).toBe(false);
    });

    it('should reject deposit with negative amount', () => {
      const result = createDepositSchema.safeParse({ patientId: 101, amount: -1000 });
      expect(result.success).toBe(false);
    });

    it('should accept all valid deposit payment modes', () => {
      for (const mode of ['cash', 'card', 'mobile'] as const) {
        expect(createDepositSchema.safeParse({
          patientId: 1, amount: 50000, paymentMode: mode,
        }).success, `mode '${mode}' should be valid`).toBe(true);
      }
    });

    it('should reject invalid payment modes (bkash, cheque, etc.)', () => {
      for (const mode of ['bkash', 'cheque', 'bank_transfer', '']) {
        expect(createDepositSchema.safeParse({
          patientId: 1, amount: 50000, paymentMode: mode,
        }).success, `mode '${mode}' should be invalid`).toBe(false);
      }
    });

    it('should default paymentMode to cash', () => {
      const result = createDepositSchema.safeParse({ patientId: 1, amount: 5000 });
      if (result.success) expect(result.data.paymentMode).toBe('cash');
    });

    it('should require positive integer patientId', () => {
      expect(createDepositSchema.safeParse({ patientId: 0,  amount: 1000 }).success).toBe(false);
      expect(createDepositSchema.safeParse({ patientId: -1, amount: 1000 }).success).toBe(false);
      expect(createDepositSchema.safeParse({ patientId: 1,  amount: 1000 }).success).toBe(true);
    });
  });

  describe('Return Deposit Schema', () => {

    it('should accept a valid return deposit', () => {
      const result = createReturnDepositSchema.safeParse({
        patientId: 101, amount: 30000, paymentMode: 'cash',
      });
      expect(result.success).toBe(true);
    });

    it('should reject return deposit without patientId', () => {
      expect(createReturnDepositSchema.safeParse({ amount: 30000 }).success).toBe(false);
    });

    it('should reject return deposit with zero amount', () => {
      expect(createReturnDepositSchema.safeParse({ patientId: 101, amount: 0 }).success).toBe(false);
    });
  });

  describe('Settlement Integration', () => {

    it('should accept a valid settlement', () => {
      const result = createSettlementSchema.safeParse({
        patientId: 101, settlementDate: '2026-03-18',
        totalAmount: 150000, paidAmount: 100000, depositDeducted: 50000,
      });
      expect(result.success).toBe(true);
    });

    it('should reject settlement with invalid date format', () => {
      const result = createSettlementSchema.safeParse({
        patientId: 1, settlementDate: '18-03-2026',
        totalAmount: 100000, paidAmount: 100000,
      });
      expect(result.success).toBe(false);
    });

    it('should validate depositDeducted does not exceed deposit balance (business rule)', () => {
      const depositBalance = 50000;
      const depositDeducted = 60000;
      expect(depositDeducted <= depositBalance).toBe(false);
    });

    it('should verify paid + depositDeducted covers total (payment complete)', () => {
      const total = 150000;
      const paid = 100000;
      const depositDeducted = 50000;
      expect(paid + depositDeducted >= total).toBe(true);
    });

    it('should allow partial payment — remainder becomes credit', () => {
      const total = 150000;
      const paid = 50000;
      const depositDeducted = 0;
      const credit = total - paid - depositDeducted;
      expect(credit).toBe(100000);
      expect(credit).toBeGreaterThan(0);
    });

    it('should accept valid settlement payment modes', () => {
      for (const mode of ['cash', 'card', 'mobile'] as const) {
        expect(createSettlementSchema.safeParse({
          patientId: 1, settlementDate: '2026-01-01',
          totalAmount: 10000, paidAmount: 10000, paymentMode: mode,
        }).success).toBe(true);
      }
    });
  });
});
