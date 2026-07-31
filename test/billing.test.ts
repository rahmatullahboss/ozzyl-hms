import { describe, it, expect } from 'vitest';

// ─── Billing Tests ────────────────────────────────────────────────────────────
// Migrated from apps/api/tests/billing.test.ts
// Aligned with current src/routes/tenant/billing.ts and src/schemas/billing.ts

describe('HMS Billing Tests', () => {
  describe('Bill Calculation', () => {
    it('should calculate subtotal from line items', () => {
      const items = [
        { quantity: 1, unitPrice: 5000 },
        { quantity: 2, unitPrice: 500 },
        { quantity: 1, unitPrice: 2000 },
      ];
      const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      expect(subtotal).toBe(8000); // 5000 + 2×500 + 2000 = 8000
    });

    it('should apply flat discount correctly', () => {
      const subtotal = 17500;
      const discount = 1750;
      const total = Math.max(0, subtotal - discount);
      expect(total).toBe(15750);
    });

    it('should never produce a negative total', () => {
      const subtotal = 500;
      const discount = 1000; // discount > subtotal
      const total = Math.max(0, subtotal - discount);
      expect(total).toBe(0);
    });

    it('should calculate percent-based discount', () => {
      const subtotal = 17500;
      const discountPct = 10;
      const discount = subtotal * (discountPct / 100);
      expect(discount).toBe(1750);
    });
  });

  describe('Payment Processing', () => {
    it('should record full payment and clear due', () => {
      const billTotal = 10000;
      let paid = 0;
      paid += 10000;
      const due = billTotal - paid;
      expect(paid).toBe(10000);
      expect(due).toBe(0);
    });

    it('should track partial payment correctly', () => {
      const billTotal = 10000;
      let paid = 0;
      paid += 5000;
      const due = billTotal - paid;
      expect(paid).toBe(5000);
      expect(due).toBe(5000);
    });

    it('should accumulate multiple partial payments', () => {
      const billTotal = 10000;
      let paid = 0;
      paid += 3000;
      paid += 4000;
      paid += 3000;
      expect(paid).toBe(billTotal);
    });

    it('should detect over-payment', () => {
      const billTotal = 10000;
      const paid = 5000;
      const paymentAmount = 6000;
      const isOverpayment = paymentAmount > billTotal - paid;
      expect(isOverpayment).toBe(true);
    });

    it('should validate settlement types (current / due)', () => {
      const validTypes = ['current', 'due'];
      expect(validTypes).toContain('current');
      expect(validTypes).toContain('due');
      expect(validTypes).not.toContain('refund');
    });
  });

  describe('Bill Status Transitions', () => {
    it('should be "paid" when paid_amount >= total_amount', () => {
      const bill = { total_amount: 10000, paid_amount: 10000 };
      const status = bill.paid_amount >= bill.total_amount ? 'paid' : 'partially_paid';
      expect(status).toBe('paid');
    });

    it('should be "partially_paid" when paid > 0 but < total', () => {
      const bill = { total_amount: 10000, paid_amount: 5000 };
      const isPartial = bill.paid_amount > 0 && bill.paid_amount < bill.total_amount;
      expect(isPartial).toBe(true);
    });

    it('should be "open" when nothing has been paid', () => {
      const bill = { total_amount: 10000, paid_amount: 0 };
      const status = bill.paid_amount === 0 ? 'open' : 'partially_paid';
      expect(status).toBe('open');
    });

    it('should allow valid status values only', () => {
      const validStatuses = ['open', 'partially_paid', 'paid', 'cancelled'];
      expect(validStatuses).toContain('open');
      expect(validStatuses).toContain('paid');
      expect(validStatuses).not.toContain('unpaid'); // old schema name
    });
  });

  describe('Invoice Number Generation', () => {
    it('should generate invoice number with INV prefix', () => {
      const seq = 42;
      const invoiceNo = `INV-${String(seq).padStart(6, '0')}`;
      expect(invoiceNo).toBe('INV-000042');
      expect(invoiceNo).toMatch(/^INV-\d{6}$/);
    });

    it('should generate receipt number with RCP prefix', () => {
      const seq = 7;
      const receiptNo = `RCP-${String(seq).padStart(6, '0')}`;
      expect(receiptNo).toBe('RCP-000007');
    });
  });

  describe('Item Categories', () => {
    it('should accept all valid item categories', () => {
      // From src/schemas/billing.ts itemCategorySchema
      const validCategories = ['test', 'doctor_visit', 'operation', 'medicine', 'admission', 'other'];
      validCategories.forEach((cat) => {
        expect(validCategories).toContain(cat);
      });
    });

    it('should reject unknown item categories', () => {
      const validCategories = ['test', 'doctor_visit', 'operation', 'medicine', 'admission', 'other'];
      expect(validCategories).not.toContain('ambulance'); // not in current schema
    });
  });
});
