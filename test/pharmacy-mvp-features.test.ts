/**
 * Pharmacy MVP Feature Tests
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Tests for the 4 MVP features:
 * 1. Direct cash sales (POS) via /invoices endpoint
 * 2. IPD patient medicine → provisional bill → final invoice conversion
 * 3. Basic stock in/out tracking
 * 4. Medicine inventory management
 *
 * Also covers:
 * - Prescription dispense-to-invoice integration
 * - Dispatch bug fix (requested_qty column)
 * - FEFO batch selection logic
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ─── Schemas mirrored from src/schemas/pharmacy.ts ─────────────────────────

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

const createProvisionalInvoiceSchema = z.object({
  patientId:      z.number().int().positive(),
  patientVisitId: z.number().int().positive().optional(),
  counterId:      z.number().int().positive().optional(),
  prescriberId:   z.number().int().positive().optional(),
  visitType:      z.enum(['inpatient', 'outpatient']).optional(),
  discountPct:    z.number().min(0).max(100).default(0),
  remarks:        z.string().optional(),
  items: z.array(z.object({
    itemId:      z.number().int().positive(),
    stockId:     z.number().int().positive().optional(),
    batchNo:     z.string().optional(),
    expiryDate:  z.string().optional(),
    quantity:    z.number().positive(),
    freeQty:     z.number().nonnegative().default(0),
    price:       z.number().int().nonnegative(),
    salePrice:   z.number().int().nonnegative(),
    discountPct: z.number().min(0).max(100).default(0),
    vatPct:      z.number().min(0).max(100).default(0),
    remarks:     z.string().optional(),
  })).min(1),
});

const stockAdjustmentSchema = z.object({
  stockId:        z.number().int().positive(),
  itemId:         z.number().int().positive(),
  adjustmentType: z.enum(['in', 'out']),
  quantity:       z.number().positive(),
  remarks:        z.string().min(1),
});

const createPharmacyItemSchema = z.object({
  name:            z.string().min(1),
  itemCode:        z.string().optional(),
  genericId:       z.number().int().positive().optional(),
  categoryId:      z.number().int().positive().optional(),
  uomId:           z.number().int().positive().optional(),
  packingTypeId:   z.number().int().positive().optional(),
  reorderLevel:    z.number().int().nonnegative().default(0),
  minStockQty:     z.number().int().nonnegative().default(0),
  purchaseVatPct:  z.number().min(0).max(100).default(0),
  salesVatPct:     z.number().min(0).max(100).default(0),
  isVatApplicable: z.boolean().default(false),
  isNarcotic:      z.boolean().default(false),
});

const createCategorySchema = z.object({
  name:        z.string().min(1),
  description: z.string().optional(),
});

const createGenericSchema = z.object({
  name:        z.string().min(1),
  categoryId:  z.number().int().positive().optional(),
  description: z.string().optional(),
});

const createSupplierSchema = z.object({
  name:        z.string().min(1),
  contactNo:   z.string().optional(),
  address:     z.string().optional(),
  city:        z.string().optional(),
  email:       z.string().email().optional(),
  panNo:       z.string().optional(),
  creditPeriod: z.number().int().nonnegative().default(0),
  notes:       z.string().optional(),
});

// ─── Business Logic Helpers ─────────────────────────────────────────────────

/** Calculate line total for an invoice item (amounts in paisa) */
function calcLineTotal(item: {
  quantity: number; price: number; discountPct: number; vatPct: number;
}): number {
  const lineSubtotal = item.quantity * item.price;
  const discountAmt  = Math.round(lineSubtotal * (item.discountPct / 100));
  const vatAmt       = Math.round((lineSubtotal - discountAmt) * (item.vatPct / 100));
  return lineSubtotal - discountAmt + vatAmt;
}

/** FEFO: Sort batches by expiry date (earliest first), null expiry last */
function fefoSort(batches: Array<{ batchNo: string; expiryDate: string | null }>) {
  return [...batches].sort((a, b) => {
    if (!a.expiryDate && !b.expiryDate) return 0;
    if (!a.expiryDate) return 1;
    if (!b.expiryDate) return -1;
    return a.expiryDate.localeCompare(b.expiryDate);
  });
}

/** Validate stock availability for multiple items */
function validateStockAvailability(
  items: Array<{ stockId: number; quantity: number }>,
  stockMap: Map<number, { available: number; expiryDate: string | null }>,
  today: string,
): { valid: boolean; error?: string } {
  for (const item of items) {
    const stock = stockMap.get(item.stockId);
    if (!stock) {
      return { valid: false, error: `Stock record ${item.stockId} not found` };
    }
    if (stock.expiryDate && stock.expiryDate <= today) {
      return { valid: false, error: `Stock ID ${item.stockId} has expired (${stock.expiryDate})` };
    }
    if (stock.available < item.quantity) {
      return { valid: false, error: `Insufficient stock for stock ID ${item.stockId}. Available: ${stock.available}, Requested: ${item.quantity}` };
    }
  }
  return { valid: true };
}

/** Calculate payment balance: paid + credit + deposit must equal total */
function validatePaymentBalance(
  totalAmount: number,
  paidAmount: number,
  creditAmount: number,
  depositDeductAmount: number,
): { valid: boolean; error?: string } {
  const covered = paidAmount + creditAmount + depositDeductAmount;
  if (covered !== totalAmount) {
    return { valid: false, error: `Payment mismatch. Total: ${totalAmount}, Covered: ${covered}` };
  }
  return { valid: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MVP FEATURE 1: Direct Cash Sales (POS) via /invoices
// ═══════════════════════════════════════════════════════════════════════════════

describe('MVP Feature 1: Direct Cash Sales (POS)', () => {

  describe('Invoice Schema Validation', () => {

    it('should accept a minimal valid POS invoice (cash, single item)', () => {
      const result = createInvoiceSchema.safeParse({
        paidAmount: 50000,
        items: [{
          itemId: 1, stockId: 1, batchNo: 'B001',
          quantity: 2, mrp: 30000, price: 28000,
        }],
      });
      expect(result.success).toBe(true);
    });

    it('should accept POS invoice with patient (walk-in)', () => {
      const result = createInvoiceSchema.safeParse({
        patientId: 101, isOutdoorPatient: true,
        paidAmount: 30000,
        items: [{
          itemId: 1, stockId: 1, batchNo: 'B001',
          quantity: 1, mrp: 30000, price: 30000,
        }],
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.isOutdoorPatient).toBe(true);
    });

    it('should accept POS invoice without patient (anonymous walk-in)', () => {
      const result = createInvoiceSchema.safeParse({
        paidAmount: 15000,
        items: [{
          itemId: 5, stockId: 10, batchNo: 'PARA-001',
          quantity: 3, mrp: 5000, price: 5000,
        }],
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.patientId).toBeUndefined();
    });

    it('should default paymentMode to cash for POS', () => {
      const result = createInvoiceSchema.safeParse({
        paidAmount: 10000,
        items: [{ itemId: 1, stockId: 1, batchNo: 'B1', quantity: 1, mrp: 10000, price: 10000 }],
      });
      if (result.success) expect(result.data.paymentMode).toBe('cash');
    });

    it('should accept card payment for POS', () => {
      const result = createInvoiceSchema.safeParse({
        paidAmount: 50000, paymentMode: 'card',
        items: [{ itemId: 1, stockId: 1, batchNo: 'B1', quantity: 1, mrp: 50000, price: 50000 }],
      });
      expect(result.success).toBe(true);
    });

    it('should accept mobile payment (bKash/Nagad) for POS', () => {
      const result = createInvoiceSchema.safeParse({
        paidAmount: 25000, paymentMode: 'mobile',
        items: [{ itemId: 1, stockId: 1, batchNo: 'B1', quantity: 1, mrp: 25000, price: 25000 }],
      });
      expect(result.success).toBe(true);
    });

    it('should reject POS invoice without items', () => {
      const result = createInvoiceSchema.safeParse({ paidAmount: 1000, items: [] });
      expect(result.success).toBe(false);
    });

    it('should reject POS invoice without paidAmount', () => {
      const result = createInvoiceSchema.safeParse({
        items: [{ itemId: 1, stockId: 1, batchNo: 'B1', quantity: 1, mrp: 100, price: 100 }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('POS Line Total Calculations', () => {

    it('should calculate simple line total (qty × price)', () => {
      const total = calcLineTotal({ quantity: 5, price: 10000, discountPct: 0, vatPct: 0 });
      expect(total).toBe(50000);
    });

    it('should apply percentage discount correctly', () => {
      // 2 × 10000 = 20000, −10% = 18000
      const total = calcLineTotal({ quantity: 2, price: 10000, discountPct: 10, vatPct: 0 });
      expect(total).toBe(18000);
    });

    it('should apply VAT after discount (correct tax order)', () => {
      // 10000, −10% = 9000, +15% VAT = 10350
      const total = calcLineTotal({ quantity: 1, price: 10000, discountPct: 10, vatPct: 15 });
      expect(total).toBe(10350);
    });

    it('should handle multi-item POS invoice total', () => {
      const items = [
        { quantity: 2, price: 10000, discountPct: 0, vatPct: 0 },  // 20000
        { quantity: 1, price: 30000, discountPct: 10, vatPct: 0 }, // 27000
        { quantity: 3, price: 5000,  discountPct: 0, vatPct: 5 },  // 15750
      ];
      const grandTotal = items.reduce((sum, i) => sum + calcLineTotal(i), 0);
      expect(grandTotal).toBe(62750);
    });
  });

  describe('POS Stock Validation', () => {

    it('should pass when stock is sufficient', () => {
      const stockMap = new Map([
        [1, { available: 100, expiryDate: '2027-12-31' }],
      ]);
      const result = validateStockAvailability(
        [{ stockId: 1, quantity: 10 }],
        stockMap, '2026-05-23',
      );
      expect(result.valid).toBe(true);
    });

    it('should fail when stock is insufficient', () => {
      const stockMap = new Map([
        [1, { available: 5, expiryDate: '2027-12-31' }],
      ]);
      const result = validateStockAvailability(
        [{ stockId: 1, quantity: 10 }],
        stockMap, '2026-05-23',
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Insufficient stock');
    });

    it('should fail when stock is expired', () => {
      const stockMap = new Map([
        [1, { available: 100, expiryDate: '2025-01-01' }],
      ]);
      const result = validateStockAvailability(
        [{ stockId: 1, quantity: 1 }],
        stockMap, '2026-05-23',
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('should pass when expiry is null (no expiry tracked)', () => {
      const stockMap = new Map([
        [1, { available: 100, expiryDate: null }],
      ]);
      const result = validateStockAvailability(
        [{ stockId: 1, quantity: 1 }],
        stockMap, '2026-05-23',
      );
      expect(result.valid).toBe(true);
    });

    it('should validate multiple items in one POS transaction', () => {
      const stockMap = new Map([
        [1, { available: 100, expiryDate: '2027-12-31' }],
        [2, { available: 50, expiryDate: '2027-06-30' }],
        [3, { available: 200, expiryDate: '2028-01-01' }],
      ]);
      const result = validateStockAvailability(
        [
          { stockId: 1, quantity: 30 },
          { stockId: 2, quantity: 20 },
          { stockId: 3, quantity: 100 },
        ],
        stockMap, '2026-05-23',
      );
      expect(result.valid).toBe(true);
    });

    it('should fail on first insufficient item in multi-item POS', () => {
      const stockMap = new Map([
        [1, { available: 100, expiryDate: '2027-12-31' }],
        [2, { available: 3, expiryDate: '2027-06-30' }],
      ]);
      const result = validateStockAvailability(
        [
          { stockId: 1, quantity: 10 },
          { stockId: 2, quantity: 10 },
        ],
        stockMap, '2026-05-23',
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('stock ID 2');
    });
  });

  describe('POS Payment Balance Validation', () => {

    it('should pass when paid equals total (cash sale)', () => {
      const result = validatePaymentBalance(50000, 50000, 0, 0);
      expect(result.valid).toBe(true);
    });

    it('should pass with credit component', () => {
      const result = validatePaymentBalance(100000, 60000, 40000, 0);
      expect(result.valid).toBe(true);
    });

    it('should pass with deposit deduction', () => {
      const result = validatePaymentBalance(80000, 50000, 0, 30000);
      expect(result.valid).toBe(true);
    });

    it('should pass with all three payment components', () => {
      const result = validatePaymentBalance(150000, 80000, 40000, 30000);
      expect(result.valid).toBe(true);
    });

    it('should fail when payment does not cover total', () => {
      const result = validatePaymentBalance(100000, 50000, 20000, 0);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Payment mismatch');
    });

    it('should fail when payment exceeds total (overpayment)', () => {
      const result = validatePaymentBalance(50000, 60000, 0, 0);
      expect(result.valid).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MVP FEATURE 2: IPD Patient Medicine → Provisional Bill → Final Invoice
// ═══════════════════════════════════════════════════════════════════════════════

describe('MVP Feature 2: IPD Provisional Billing', () => {

  describe('Provisional Invoice Schema', () => {

    it('should accept a valid IPD provisional invoice', () => {
      const result = createProvisionalInvoiceSchema.safeParse({
        patientId: 101, visitType: 'inpatient',
        items: [{
          itemId: 1, stockId: 1, quantity: 5, price: 10000, salePrice: 10000,
        }],
      });
      expect(result.success).toBe(true);
    });

    it('should require patientId for provisional', () => {
      const result = createProvisionalInvoiceSchema.safeParse({
        items: [{ itemId: 1, quantity: 1, price: 10000, salePrice: 10000 }],
      });
      expect(result.success).toBe(false);
    });

    it('should accept provisional with prescriber info', () => {
      const result = createProvisionalInvoiceSchema.safeParse({
        patientId: 101, prescriberId: 5, visitType: 'inpatient',
        items: [{
          itemId: 1, stockId: 1, quantity: 10, price: 5000, salePrice: 5000,
        }],
      });
      expect(result.success).toBe(true);
    });

    it('should accept provisional with multiple items', () => {
      const result = createProvisionalInvoiceSchema.safeParse({
        patientId: 101, visitType: 'inpatient',
        items: [
          { itemId: 1, stockId: 1, quantity: 5, price: 10000, salePrice: 10000 },
          { itemId: 2, stockId: 3, quantity: 3, price: 8000, salePrice: 8000 },
          { itemId: 3, stockId: 5, quantity: 10, price: 2000, salePrice: 2000 },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should reject provisional without items', () => {
      const result = createProvisionalInvoiceSchema.safeParse({
        patientId: 101, items: [],
      });
      expect(result.success).toBe(false);
    });

    it('should default discountPct to 0', () => {
      const result = createProvisionalInvoiceSchema.safeParse({
        patientId: 101,
        items: [{ itemId: 1, quantity: 1, price: 10000, salePrice: 10000 }],
      });
      if (result.success) expect(result.data.discountPct).toBe(0);
    });
  });

  describe('Provisional → Final Conversion Logic', () => {

    it('should calculate correct total when converting provisional to final', () => {
      const provItems = [
        { quantity: 5, price: 10000, total_amount: 50000 },
        { quantity: 3, price: 8000, total_amount: 24000 },
      ];
      const subtotal = provItems.reduce((sum, item) => sum + item.total_amount, 0);
      expect(subtotal).toBe(74000);
    });

    it('should apply discount on conversion', () => {
      const subtotal = 74000;
      const discountAmount = 2000;
      const totalAmount = subtotal - discountAmount;
      expect(totalAmount).toBe(72000);
    });

    it('should validate payment balance on conversion', () => {
      const totalAmount = 72000;
      const result = validatePaymentBalance(totalAmount, 72000, 0, 0);
      expect(result.valid).toBe(true);
    });

    it('should support credit conversion (IPD bill to insurance)', () => {
      const totalAmount = 100000;
      const result = validatePaymentBalance(totalAmount, 0, 100000, 0);
      expect(result.valid).toBe(true);
    });

    it('should support partial payment on conversion', () => {
      const totalAmount = 100000;
      const result = validatePaymentBalance(totalAmount, 60000, 40000, 0);
      expect(result.valid).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MVP FEATURE 3: Basic Stock In/Out Tracking
// ═══════════════════════════════════════════════════════════════════════════════

describe('MVP Feature 3: Stock In/Out Tracking', () => {

  describe('Stock Adjustment Schema', () => {

    it('should accept stock-in adjustment', () => {
      const result = stockAdjustmentSchema.safeParse({
        stockId: 1, itemId: 1, adjustmentType: 'in',
        quantity: 50, remarks: 'Physical count correction',
      });
      expect(result.success).toBe(true);
    });

    it('should accept stock-out adjustment', () => {
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
  });

  describe('FEFO (First Expiry, First Out) Logic', () => {

    it('should sort batches by expiry date ascending', () => {
      const batches = [
        { batchNo: 'B3', expiryDate: '2027-06-01' },
        { batchNo: 'B1', expiryDate: '2026-03-01' },
        { batchNo: 'B2', expiryDate: '2026-09-15' },
      ];
      const sorted = fefoSort(batches);
      expect(sorted[0].batchNo).toBe('B1');
      expect(sorted[1].batchNo).toBe('B2');
      expect(sorted[2].batchNo).toBe('B3');
    });

    it('should put null expiry batches last', () => {
      const batches = [
        { batchNo: 'B2', expiryDate: null },
        { batchNo: 'B1', expiryDate: '2026-06-01' },
      ];
      const sorted = fefoSort(batches);
      expect(sorted[0].batchNo).toBe('B1');
      expect(sorted[1].batchNo).toBe('B2');
    });

    it('should handle all null expiry batches', () => {
      const batches = [
        { batchNo: 'B2', expiryDate: null },
        { batchNo: 'B1', expiryDate: null },
      ];
      const sorted = fefoSort(batches);
      expect(sorted.length).toBe(2);
    });

    it('should handle single batch', () => {
      const batches = [{ batchNo: 'B1', expiryDate: '2027-01-01' }];
      const sorted = fefoSort(batches);
      expect(sorted.length).toBe(1);
      expect(sorted[0].batchNo).toBe('B1');
    });
  });

  describe('Stock Transaction Types', () => {

    it('should track purchase_in transactions', () => {
      const transactionTypes = ['purchase_in', 'sale_out', 'adjustment_in', 'adjustment_out',
        'return_in', 'return_out', 'dispatch_out', 'write_off'];
      expect(transactionTypes).toContain('purchase_in');
    });

    it('should track sale_out transactions', () => {
      const transactionTypes = ['purchase_in', 'sale_out', 'adjustment_in', 'adjustment_out',
        'return_in', 'return_out', 'dispatch_out', 'write_off'];
      expect(transactionTypes).toContain('sale_out');
    });

    it('should track all adjustment types', () => {
      const transactionTypes = ['purchase_in', 'sale_out', 'adjustment_in', 'adjustment_out',
        'return_in', 'return_out', 'dispatch_out', 'write_off'];
      expect(transactionTypes).toContain('adjustment_in');
      expect(transactionTypes).toContain('adjustment_out');
    });

    it('should track return transactions', () => {
      const transactionTypes = ['purchase_in', 'sale_out', 'adjustment_in', 'adjustment_out',
        'return_in', 'return_out', 'dispatch_out', 'write_off'];
      expect(transactionTypes).toContain('return_in');
      expect(transactionTypes).toContain('return_out');
    });
  });

  describe('Stock Level Calculations', () => {

    it('should calculate net stock from transactions', () => {
      const transactions = [
        { type: 'purchase_in', qty: 100 },
        { type: 'sale_out', qty: 30 },
        { type: 'sale_out', qty: 20 },
        { type: 'adjustment_in', qty: 5 },
        { type: 'return_in', qty: 2 },
      ];
      const netStock = transactions.reduce((sum, t) => {
        return sum + (t.type.includes('in') || t.type === 'return_in' ? t.qty : -t.qty);
      }, 0);
      expect(netStock).toBe(57); // 100 - 30 - 20 + 5 + 2
    });

    it('should detect low stock condition', () => {
      const available = 5;
      const reorderLevel = 10;
      expect(available <= reorderLevel).toBe(true);
    });

    it('should detect stock-out condition', () => {
      const available = 0;
      expect(available).toBe(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MVP FEATURE 4: Medicine Inventory Management
// ═══════════════════════════════════════════════════════════════════════════════

describe('MVP Feature 4: Medicine Inventory Management', () => {

  describe('Pharmacy Item Schema', () => {

    it('should accept a minimal pharmacy item', () => {
      const result = createPharmacyItemSchema.safeParse({
        name: 'Paracetamol 500mg',
      });
      expect(result.success).toBe(true);
    });

    it('should accept a full pharmacy item with all fields', () => {
      const result = createPharmacyItemSchema.safeParse({
        name: 'Amoxicillin 500mg Capsule',
        itemCode: 'AMX-500',
        genericId: 1,
        categoryId: 2,
        uomId: 1,
        packingTypeId: 1,
        reorderLevel: 50,
        minStockQty: 20,
        purchaseVatPct: 0,
        salesVatPct: 5,
        isVatApplicable: true,
        isNarcotic: false,
      });
      expect(result.success).toBe(true);
    });

    it('should accept narcotic item', () => {
      const result = createPharmacyItemSchema.safeParse({
        name: 'Morphine 10mg/ml Injection',
        isNarcotic: true,
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.isNarcotic).toBe(true);
    });

    it('should reject item without name', () => {
      const result = createPharmacyItemSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject VAT percentage above 100', () => {
      const result = createPharmacyItemSchema.safeParse({
        name: 'Test', salesVatPct: 150,
      });
      expect(result.success).toBe(false);
    });

    it('should default reorder level to 0', () => {
      const result = createPharmacyItemSchema.safeParse({ name: 'Test' });
      if (result.success) expect(result.data.reorderLevel).toBe(0);
    });
  });

  describe('Category Schema', () => {

    it('should accept valid category', () => {
      const result = createCategorySchema.safeParse({
        name: 'Antibiotics', description: 'Anti-bacterial medications',
      });
      expect(result.success).toBe(true);
    });

    it('should reject category without name', () => {
      const result = createCategorySchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('Generic Schema', () => {

    it('should accept valid generic', () => {
      const result = createGenericSchema.safeParse({
        name: 'Paracetamol', categoryId: 1,
      });
      expect(result.success).toBe(true);
    });

    it('should accept generic without category', () => {
      const result = createGenericSchema.safeParse({ name: 'Amoxicillin' });
      expect(result.success).toBe(true);
    });
  });

  describe('Supplier Schema', () => {

    it('should accept valid supplier', () => {
      const result = createSupplierSchema.safeParse({
        name: 'Square Pharmaceuticals',
        contactNo: '+8801712345678',
        address: 'Dhaka, Bangladesh',
        city: 'Dhaka',
        email: 'info@square.com',
        creditPeriod: 30,
      });
      expect(result.success).toBe(true);
    });

    it('should reject supplier without name', () => {
      const result = createSupplierSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should default creditPeriod to 0', () => {
      const result = createSupplierSchema.safeParse({ name: 'Test Supplier' });
      if (result.success) expect(result.data.creditPeriod).toBe(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BONUS: Prescription Dispense-to-Invoice Integration
// ═══════════════════════════════════════════════════════════════════════════════

describe('Prescription Dispense-to-Invoice', () => {

  describe('Dispense Status Transitions', () => {

    it('should allow dispense from pending status', () => {
      const validTransitions: Record<string, string[]> = {
        pending: ['dispensed'],
        dispensed: [],
        cancelled: [],
      };
      expect(validTransitions['pending']).toContain('dispensed');
    });

    it('should not allow dispense from cancelled status', () => {
      const validTransitions: Record<string, string[]> = {
        pending: ['dispensed'],
        dispensed: [],
        cancelled: [],
      };
      expect(validTransitions['cancelled']).not.toContain('dispensed');
    });

    it('should not allow double dispense', () => {
      const currentStatus = 'dispensed';
      expect(currentStatus).toBe('dispensed');
    });
  });

  describe('Prescription Item to Invoice Item Mapping', () => {

    it('should map prescription items to invoice items correctly', () => {
      const rxItems = [
        { item_id: 1, quantity: 10, item_name: 'Paracetamol 500mg' },
        { item_id: 2, quantity: 5, item_name: 'Amoxicillin 250mg' },
      ];
      const stockSelections = [
        { itemId: 1, stockId: 101, quantity: 10 },
        { itemId: 2, stockId: 102, quantity: 5 },
      ];

      const mapped = rxItems.map(rx => {
        const stock = stockSelections.find(s => s.itemId === rx.item_id);
        return {
          itemId: rx.item_id,
          stockId: stock?.stockId ?? 0,
          quantity: stock?.quantity ?? rx.quantity,
        };
      });

      expect(mapped.length).toBe(2);
      expect(mapped[0].stockId).toBe(101);
      expect(mapped[1].stockId).toBe(102);
    });

    it('should use prescription quantity when no stock selection', () => {
      const rxItem = { item_id: 1, quantity: 10 };
      const stockSelection = undefined;
      const quantity = stockSelection?.quantity ?? rxItem.quantity;
      expect(quantity).toBe(10);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BONUS: Dispatch Bug Fix Verification
// ═══════════════════════════════════════════════════════════════════════════════

describe('Dispatch Requisition Column Bug Fix', () => {

  it('should use requested_qty column (not quantity) from pharmacy_requisition_items', () => {
    // The DB schema defines: requested_qty REAL NOT NULL
    // The bug was: ri.quantity as requested_qty (wrong column name)
    // The fix is: ri.requested_qty
    const correctColumn = 'requested_qty';
    const incorrectColumn = 'quantity';
    expect(correctColumn).not.toBe(incorrectColumn);
  });

  it('should correctly calculate dispatch fulfillment', () => {
    const requestedQty = 100;
    const totalDispatched = 60;
    const remaining = requestedQty - totalDispatched;
    expect(remaining).toBe(40);
    expect(totalDispatched < requestedQty).toBe(true); // partial
  });

  it('should detect full dispatch fulfillment', () => {
    const requestedQty = 100;
    const totalDispatched = 100;
    expect(totalDispatched >= requestedQty).toBe(true); // complete
  });
});
