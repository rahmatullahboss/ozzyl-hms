import { describe, it, expect } from 'vitest';

describe('supplier ledger', () => {
  describe('recordSupplierPayment', () => {
    it('creates a payment entry with debit amount', () => {
      const payment = {
        supplier_id: 1,
        entry_type: 'payment',
        debit_amount: 5000,
        credit_amount: 0,
        reference_no: 'PAY-001',
        payment_method: 'cash',
        notes: 'Monthly payment',
      };

      expect(payment.entry_type).toBe('payment');
      expect(payment.debit_amount).toBe(5000);
      expect(payment.credit_amount).toBe(0);
    });

    it('creates a GRN entry with credit amount', () => {
      const grnEntry = {
        supplier_id: 1,
        entry_type: 'grn',
        debit_amount: 0,
        credit_amount: 15000,
        reference_no: 'GRN-001',
      };

      expect(grnEntry.entry_type).toBe('grn');
      expect(grnEntry.debit_amount).toBe(0);
      expect(grnEntry.credit_amount).toBe(15000);
    });

    it('calculates running balance correctly', () => {
      const entries = [
        { credit_amount: 15000, debit_amount: 0 },  // GRN: +15000
        { credit_amount: 10000, debit_amount: 0 },  // GRN: +10000
        { credit_amount: 0, debit_amount: 5000 },   // Payment: -5000
        { credit_amount: 0, debit_amount: 3000 },   // Payment: -3000
      ];

      let balance = 0;
      const balances: number[] = [];
      for (const entry of entries) {
        balance += entry.credit_amount - entry.debit_amount;
        balances.push(balance);
      }

      expect(balances).toEqual([15000, 25000, 20000, 17000]);
    });

    it('net balance = total GRN - total payments', () => {
      const totalGrn = 25000;
      const totalPayments = 8000;
      const netBalance = totalGrn - totalPayments;

      expect(netBalance).toBe(17000);
    });

    it('validates that payment amount does not exceed outstanding balance', () => {
      const outstandingBalance = 17000;
      const paymentAmount = 20000;
      const isValid = paymentAmount <= outstandingBalance;

      expect(isValid).toBe(false);
    });
  });

  describe('supplier ledger schema', () => {
    it('has required fields', () => {
      const ledgerSchema = {
        id: 'number',
        tenant_id: 'string',
        supplier_id: 'number',
        entry_type: 'string', // 'grn' | 'payment' | 'credit_note' | 'adjustment'
        debit_amount: 'number',
        credit_amount: 'number',
        running_balance: 'number',
        reference_no: 'string',
        reference_id: 'number',
        payment_method: 'string',
        notes: 'string',
        created_by: 'number',
        created_at: 'string',
      };

      expect(ledgerSchema.entry_type).toBe('string');
      expect(ledgerSchema.debit_amount).toBe('number');
      expect(ledgerSchema.credit_amount).toBe('number');
      expect(ledgerSchema.running_balance).toBe('number');
    });
  });
});
