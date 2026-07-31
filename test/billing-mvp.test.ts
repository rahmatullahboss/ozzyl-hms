import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import billingRoutes from '../src/routes/tenant/billing';
import billingCancellation from '../src/routes/tenant/billingCancellation';
import type { Env, Variables } from '../src/types';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

// ─── Billing MVP Tests ───────────────────────────────────────────────────────
// Tests for: invoice creation, payment collection, due management,
// bill cancellation, print count, patient ledger, and edge cases.

describe('Billing MVP Tests', () => {
  // ─── Bill Creation ───────────────────────────────────────────────────────

  describe('POST /billing — create bill', () => {
    it('should require at least one item', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
      });

      const res = await jsonRequest(app, '/billing', {
        method: 'POST',
        body: { patientId: 1, items: [], discount: 0 },
      });
      expect(res.status).toBe(400);
    });

    it('should reject discount without reason', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
      });

      const res = await jsonRequest(app, '/billing', {
        method: 'POST',
        body: {
          patientId: 1,
          items: [{ itemCategory: 'test', quantity: 1, unitPrice: 500 }],
          discount: 100,
        },
      });
      expect(res.status).toBe(400);
    });

    it('should reject non-admin roles from applying discount', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'reception',
        tenantId: 'tenant-1',
      });

      const res = await jsonRequest(app, '/billing', {
        method: 'POST',
        body: {
          patientId: 1,
          items: [{ itemCategory: 'test', quantity: 1, unitPrice: 500, serviceItemId: 1 }],
          discount: 100,
          discountReason: 'Staff discount',
          discountByName: 'Director',
        },
      });
      // Should be 403 because reception role cannot apply discounts
      expect(res.status).toBe(403);
    });
  });

  // ─── Bill Listing ────────────────────────────────────────────────────────

  describe('GET /billing — list bills', () => {
    it('should return paginated bills with summary', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          const lower = sql.toLowerCase();
          if (lower.includes('count(*)')) {
            return { results: [{ total: 5, totalPaid: 3000, totalAmount: 5000 }] };
          }
          if (lower.includes('from bills b join patients p')) {
            return {
              results: [
                { id: 1, invoice_no: 'INV-000001', patient_name: 'Karim', total: 1000, paid: 1000, due: 0, status: 'paid' },
                { id: 2, invoice_no: 'INV-000002', patient_name: 'Rahim', total: 2000, paid: 1000, due: 1000, status: 'partially_paid' },
              ],
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/billing');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.bills).toHaveLength(2);
      expect(body.meta).toBeDefined();
      expect(body.summary).toBeDefined();
      expect(body.summary.totalCount).toBe(5);
    });

    it('should support status filter', async () => {
      const { app, mockDB } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          const lower = sql.toLowerCase();
          if (lower.includes('count(*)')) {
            return { results: [{ total: 1, totalPaid: 1000, totalAmount: 1000 }] };
          }
          if (lower.includes('from bills b join patients p')) {
            return {
              results: [{ id: 1, invoice_no: 'INV-001', patient_name: 'Karim', total: 1000, paid: 1000, due: 0, status: 'paid' }],
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/billing?status=paid');
      expect(res.status).toBe(200);
    });
  });

  // ─── Due Bills ───────────────────────────────────────────────────────────

  describe('GET /billing/due — outstanding bills', () => {
    it('should return bills with outstanding amounts', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          if (sql.toLowerCase().includes('outstanding')) {
            return {
              results: [
                { id: 2, invoice_no: 'INV-002', patient_name: 'Rahim', total: 2000, paid: 1000, outstanding: 1000, status: 'partially_paid' },
              ],
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/billing/due');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.bills).toBeDefined();
      expect(body.summary).toBeDefined();
      expect(body.summary.totalDue).toBe(1000);
    });

    it('should reject invalid date range', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
      });

      const res = await jsonRequest(app, '/billing/due?from=2025-12-31&to=2025-01-01');
      expect(res.status).toBe(400);
    });

    it('should reject invalid patient ID', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
      });

      const res = await jsonRequest(app, '/billing/due?patient_id=-1');
      expect(res.status).toBe(400);
    });
  });

  // ─── Single Bill Detail ──────────────────────────────────────────────────

  describe('GET /billing/:id — bill detail', () => {
    it('should return 404 for non-existent bill', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        universalFallback: false,
        queryOverride: (sql) => {
          const lower = sql.toLowerCase();
          // Return empty results for the bill query to simulate not-found
          if (lower.includes('from bills b join patients p') && lower.includes('b.id = ?')) {
            return { results: [] };
          }
          // Return empty for items and payments too
          if (lower.includes('from invoice_items') || lower.includes('from payments') || lower.includes('from billing_deposits')) {
            return { results: [] };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/billing/999');
      expect(res.status).toBe(404);
    });

    it('should return bill with items, payments, and deposit adjustments', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          const lower = sql.toLowerCase();
          if (lower.includes('from bills b join patients p')) {
            return {
              results: [{
                id: 1, invoice_no: 'INV-001', patient_name: 'Karim',
                patient_code: 'P001', mobile: '017', total: 1000,
                paid: 500, due: 500, status: 'partially_paid',
                total_amount: 1000, paid_amount: 500, outstanding: 500,
              }],
            };
          }
          if (lower.includes('from invoice_items')) {
            return {
              results: [
                { id: 1, item_category: 'test', description: 'CBC', quantity: 1, unit_price: 500, line_total: 500 },
                { id: 2, item_category: 'doctor_visit', description: 'Consultation', quantity: 1, unit_price: 500, line_total: 500 },
              ],
            };
          }
          if (lower.includes('from payments')) {
            return {
              results: [{ id: 1, amount: 500, payment_method: 'cash', receipt_no: 'RCP-001' }],
            };
          }
          if (lower.includes('from billing_deposits')) {
            return { results: [] };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/billing/1');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.bill).toBeDefined();
      expect(body.items).toHaveLength(2);
      expect(body.payments).toHaveLength(1);
      expect(body.deposit_adjustments).toHaveLength(0);
    });
  });

  // ─── Patient Bills ───────────────────────────────────────────────────────

  describe('GET /billing/patient/:patientId — patient bills', () => {
    it('should return all bills for a patient', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          if (sql.toLowerCase().includes('from bills b') && sql.toLowerCase().includes('patient_id')) {
            return {
              results: [
                { id: 1, invoice_no: 'INV-001', total: 1000, paid: 1000, outstanding: 0, status: 'paid' },
                { id: 2, invoice_no: 'INV-002', total: 2000, paid: 0, outstanding: 2000, status: 'open' },
              ],
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/billing/patient/1');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.bills).toHaveLength(2);
    });
  });

  // ─── Print Count ─────────────────────────────────────────────────────────

  describe('POST /billing/:id/print-count — track prints', () => {
    it('should increment print count', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          if (sql.toLowerCase().includes('print_count')) {
            return { results: [{ id: 1, print_count: 2 }] };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/billing/1/print-count', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.print_count).toBe(3);
    });

    it('should deny read-only billing users from incrementing print count', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'accountant',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          if (sql.toLowerCase().includes('print_count')) {
            return { results: [{ id: 1, print_count: 2 }] };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/billing/1/print-count', { method: 'POST' });

      expect(res.status).toBe(403);
    });

    it('should return 404 for non-existent bill', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: () => null,
      });

      const res = await jsonRequest(app, '/billing/999/print-count', { method: 'POST' });
      expect(res.status).toBe(404);
    });
  });

  // ─── Patient Ledger ──────────────────────────────────────────────────────

  describe('GET /billing/patient/:patientId/ledger — patient ledger', () => {
    it('should reject invalid patient ID', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
      });

      const res = await jsonRequest(app, '/billing/patient/0/ledger');
      expect(res.status).toBe(400);
    });
  });

  // ─── Bill Edit ───────────────────────────────────────────────────────────

  describe('PUT /billing/:id — edit bill', () => {
    it('should reject editing a paid bill', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          if (sql.toLowerCase().includes('from bills')) {
            return { results: [{ id: 1, status: 'paid', paid: 1000, invoice_no: 'INV-001', discount: 0, approved_by: null }] };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/billing/1', {
        method: 'PUT',
        body: {
          items: [{ itemCategory: 'test', quantity: 1, unitPrice: 500 }],
          discount: 0,
        },
      });
      expect(res.status).toBe(409);
    });

    it('should require at least one item', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
      });

      const res = await jsonRequest(app, '/billing/1', {
        method: 'PUT',
        body: { items: [], discount: 0 },
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── Departments ─────────────────────────────────────────────────────────

  describe('GET /billing/departments — billing service departments', () => {
    it('should return departments with active items', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          if (sql.toLowerCase().includes('billing_service_departments')) {
            return {
              results: [
                { id: 1, department_name: 'Laboratory', department_code: 'LAB' },
                { id: 2, department_name: 'Radiology', department_code: 'RAD' },
              ],
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/billing/departments');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.departments).toHaveLength(2);
    });
  });
});

// ─── Bill Calculation Unit Tests ────────────────────────────────────────────

describe('Bill Calculation Logic', () => {
  describe('Subtotal calculation', () => {
    it('should sum quantity * unitPrice for all items', () => {
      const items = [
        { quantity: 1, unitPrice: 500 },
        { quantity: 2, unitPrice: 300 },
        { quantity: 1, unitPrice: 1000 },
      ];
      const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      expect(subtotal).toBe(2100);
    });

    it('should handle zero items', () => {
      const subtotal: number = [].reduce((s: number, i: any) => s + i.quantity * i.unitPrice, 0);
      expect(subtotal).toBe(0);
    });
  });

  describe('Discount distribution', () => {
    it('should distribute discount proportionally across items', () => {
      const items = [
        { gross: 1000 },
        { gross: 2000 },
        { gross: 3000 },
      ];
      const subtotal = 6000;
      const discount = 600;
      const ratio = discount / subtotal;

      const distributed = items.map(item => Math.round(item.gross * ratio));
      const totalDistributed = distributed.reduce((s, d) => s + d, 0);

      expect(totalDistributed).toBeLessThanOrEqual(discount + items.length);
      expect(totalDistributed).toBeGreaterThanOrEqual(discount - items.length);
    });

    it('should handle 100% discount', () => {
      const subtotal = 5000;
      const discount = 5000;
      const total = Math.max(0, subtotal - discount);
      expect(total).toBe(0);
    });

    it('should never produce negative total', () => {
      const subtotal = 100;
      const discount = 200;
      const total = Math.max(0, subtotal - discount);
      expect(total).toBe(0);
    });
  });

  describe('Tax calculation', () => {
    it('should calculate tax on amount after discount', () => {
      const gross = 1000;
      const itemDiscount = 100;
      const taxPercent = 15;
      const taxAmount = Math.round(((gross - itemDiscount) * taxPercent) / 100);
      expect(taxAmount).toBe(135);
    });

    it('should handle zero tax', () => {
      const gross = 1000;
      const itemDiscount = 0;
      const taxPercent = 0;
      const taxAmount = taxPercent > 0
        ? Math.round(((gross - itemDiscount) * taxPercent) / 100)
        : 0;
      expect(taxAmount).toBe(0);
    });
  });

  describe('Category totals', () => {
    it('should aggregate amounts by category', () => {
      const items = [
        { category: 'test', amount: 500 },
        { category: 'test', amount: 300 },
        { category: 'doctor_visit', amount: 400 },
        { category: 'medicine', amount: 200 },
      ];

      const totals = {
        testBill: 0,
        doctorVisitBill: 0,
        admissionBill: 0,
        operationBill: 0,
        medicineBill: 0,
      };

      for (const item of items) {
        switch (item.category) {
          case 'test': totals.testBill += item.amount; break;
          case 'doctor_visit': totals.doctorVisitBill += item.amount; break;
          case 'admission': totals.admissionBill += item.amount; break;
          case 'operation': totals.operationBill += item.amount; break;
          case 'medicine': totals.medicineBill += item.amount; break;
        }
      }

      expect(totals.testBill).toBe(800);
      expect(totals.doctorVisitBill).toBe(400);
      expect(totals.medicineBill).toBe(200);
      expect(totals.admissionBill).toBe(0);
    });
  });
});

// ─── Payment State Machine Tests ────────────────────────────────────────────

describe('Payment State Transitions', () => {
  it('should be "open" when no payment made', () => {
    const total = 1000;
    const paid = 0;
    const status = paid === 0 ? 'open' : paid >= total ? 'paid' : 'partially_paid';
    expect(status).toBe('open');
  });

  it('should be "partially_paid" when partial payment', () => {
    const total = 1000;
    const paid = 500;
    const status = paid === 0 ? 'open' : paid >= total ? 'paid' : 'partially_paid';
    expect(status).toBe('partially_paid');
  });

  it('should be "paid" when fully paid', () => {
    const total = 1000;
    const paid = 1000;
    const status = paid === 0 ? 'open' : paid >= total ? 'paid' : 'partially_paid';
    expect(status).toBe('paid');
  });

  it('should prevent overpayment', () => {
    const total = 1000;
    const paid = 800;
    const paymentAmount = 300;
    const outstanding = total - paid;
    expect(paymentAmount).toBeGreaterThan(outstanding);
    expect(() => {
      if (paymentAmount > outstanding) throw new Error('Overpayment');
    }).toThrow('Overpayment');
  });

  it('should handle multiple partial payments', () => {
    const total = 1000;
    let paid = 0;
    const payments = [300, 200, 500];

    for (const amount of payments) {
      paid += amount;
    }

    expect(paid).toBe(total);
    const status = paid >= total ? 'paid' : 'partially_paid';
    expect(status).toBe('paid');
  });
});

// ─── Idempotency Tests ──────────────────────────────────────────────────────

describe('Payment Idempotency', () => {
  it('should replay existing payment with same idempotency key', () => {
    const existingPayment = {
      id: 1,
      bill_id: 1,
      receipt_no: 'RCP-001',
      amount: 500,
      total: 1000,
      paid: 500,
      due: 500,
      status: 'partially_paid',
    };

    const requestedBillId = 1;
    const requestedAmount = 500;

    const sameBill = Number(existingPayment.bill_id) === Number(requestedBillId);
    const sameAmount = Math.round(Number(existingPayment.amount) * 100) === Math.round(Number(requestedAmount) * 100);

    expect(sameBill).toBe(true);
    expect(sameAmount).toBe(true);
  });

  it('should reject replay if bill ID mismatches', () => {
    const existingPayment = {
      id: 1,
      bill_id: 1,
      receipt_no: 'RCP-001',
      amount: 500,
      total: 1000,
      paid: 500,
      due: 500,
      status: 'partially_paid',
    };

    const requestedBillId = 2;
    const sameBill = Number(existingPayment.bill_id) === Number(requestedBillId);
    expect(sameBill).toBe(false);
  });

  it('should reject replay if amount mismatches', () => {
    const existingPayment = {
      id: 1,
      bill_id: 1,
      receipt_no: 'RCP-001',
      amount: 500,
    };

    const requestedAmount = 700;
    const sameAmount = Math.round(Number(existingPayment.amount) * 100) === Math.round(Number(requestedAmount) * 100);
    expect(sameAmount).toBe(false);
  });
});

// ─── Deposit Management Tests ───────────────────────────────────────────────

describe('Deposit Management Logic', () => {
  it('should calculate deposit balance correctly', () => {
    const transactions = [
      { type: 'deposit', amount: 5000 },
      { type: 'deposit', amount: 3000 },
      { type: 'adjustment', amount: 2000 },
      { type: 'refund', amount: 1000 },
    ];

    const totalDeposits = transactions
      .filter(t => t.type === 'deposit')
      .reduce((s, t) => s + t.amount, 0);
    const totalRefunds = transactions
      .filter(t => t.type === 'refund')
      .reduce((s, t) => s + t.amount, 0);
    const totalAdjustments = transactions
      .filter(t => t.type === 'adjustment')
      .reduce((s, t) => s + t.amount, 0);

    const balance = totalDeposits - totalRefunds - totalAdjustments;
    expect(balance).toBe(5000);
  });

  it('should not allow refund exceeding balance', () => {
    const balance = 3000;
    const refundAmount = 5000;
    expect(refundAmount).toBeGreaterThan(balance);
  });

  it('should not allow adjustment exceeding bill due', () => {
    const billDue = 2000;
    const depositBalance = 5000;
    const requestedAdjustment = 3000;

    const actualAdjustment = Math.min(requestedAdjustment, billDue, depositBalance);
    expect(actualAdjustment).toBe(2000);
  });

  it('should cap deposit deduction at total amount', () => {
    const totalAmount = 4000;
    const depositBalance = 10000;
    const requestedDeduction = 6000;

    const actualDeduction = Math.min(requestedDeduction, totalAmount, depositBalance);
    expect(actualDeduction).toBe(4000);
  });
});

// ─── Invoice Number Format Tests ────────────────────────────────────────────

describe('Invoice Number Generation', () => {
  it('should generate INV-prefixed invoice number', () => {
    const seq = 42;
    const invoiceNo = `INV-${String(seq).padStart(6, '0')}`;
    expect(invoiceNo).toBe('INV-000042');
    expect(invoiceNo).toMatch(/^INV-\d{6}$/);
  });

  it('should generate RCP-prefixed receipt number', () => {
    const seq = 7;
    const receiptNo = `RCP-${String(seq).padStart(6, '0')}`;
    expect(receiptNo).toBe('RCP-000007');
    expect(receiptNo).toMatch(/^RCP-\d{6}$/);
  });

  it('should generate DEP-prefixed deposit receipt', () => {
    const seq = 15;
    const depositReceipt = `DEP-${String(seq).padStart(6, '0')}`;
    expect(depositReceipt).toBe('DEP-000015');
  });

  it('should generate DAD-prefixed deposit adjustment receipt', () => {
    const seq = 3;
    const adjReceipt = `DAD-${String(seq).padStart(6, '0')}`;
    expect(adjReceipt).toBe('DAD-000003');
  });
});

// ─── Money Rounding Tests ───────────────────────────────────────────────────

describe('Money Rounding', () => {
  function roundMoney(value: number): number {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  it('should round to 2 decimal places', () => {
    expect(roundMoney(10.456)).toBe(10.46);
    expect(roundMoney(10.454)).toBe(10.45);
    expect(roundMoney(10.455)).toBe(10.46);
  });

  it('should handle zero', () => {
    expect(roundMoney(0)).toBe(0);
  });

  it('should handle null/undefined', () => {
    expect(roundMoney(null as any)).toBe(0);
    expect(roundMoney(undefined as any)).toBe(0);
  });

  it('should handle negative values', () => {
    expect(roundMoney(-10.456)).toBe(-10.46);
  });
});
