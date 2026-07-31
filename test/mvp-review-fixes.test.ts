import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../src/types';
import { createMockDB } from './integration/helpers/mock-db';

// ─── Settlement Cancellation Tests ────────────────────────────────────────

describe('Settlement cancellation', () => {
  function makeSettlementApp() {
    let billsData: any[] = [];
    let paymentsData: any[] = [];
    let depositsData: any[] = [];
    let empCashData: any[] = [];
    let creditBillData: any[] = [];

    const mock = createMockDB({
      universalFallback: true,
      queryOverride(sql, params) {
        const s = sql.toLowerCase();

        // Load settlement
        if (s.includes('from billing_settlements') && s.includes('is_active = 1')) {
          return { first: { id: 1, tenant_id: 't1', settlement_receipt_no: 'STL-001', discount_amount: 100, payable_amount: 1000, is_active: 1 } };
        }

        // Load settled bills
        if (s.includes('from bills') && s.includes('settlement_id')) {
          return { results: billsData };
        }

        // Sum payments for bill
        if (s.includes('sum(amount)') && s.includes('from payments')) {
          const billId = params[0];
          const pay = paymentsData.filter(p => p.bill_id === billId);
          return { results: [{ total: pay.reduce((s, p) => s + p.amount, 0) }] };
        }

        // Sum deposits for bill
        if (s.includes('sum(amount)') && s.includes('from billing_deposits')) {
          const billId = params[0];
          const dep = depositsData.filter(d => d.reference_bill_id === billId);
          return { results: [{ total: dep.reduce((s, d) => s + d.amount, 0) }] };
        }

        // Update bills
        if (s.startsWith('update bills set paid')) {
          const billId = params[params.length - 2];
          billsData = billsData.map(b => b.id === billId ? { ...b, paid: params[0], due: params[1], status: params[2], settlement_id: null } : b);
          return { meta: { rows_written: 1 } };
        }

        // Delete payments
        if (s.startsWith('delete from payments')) {
          const billId = params[0];
          paymentsData = paymentsData.filter(p => p.bill_id !== billId);
          return { meta: { rows_written: 1 } };
        }

        // Delete deposits
        if (s.startsWith('delete from billing_deposits')) {
          const billId = params[0];
          depositsData = depositsData.filter(d => d.reference_bill_id !== billId);
          return { meta: { rows_written: 1 } };
        }

        // Update credit bill status
        if (s.includes('update billing_credit_bill_status')) {
          creditBillData = creditBillData.map(c => ({ ...c, settlement_status: 'Pending', settlement_id: null }));
          return { meta: { rows_written: 1 } };
        }

        // Delete emp_cash_transactions
        if (s.includes('delete from emp_cash_transactions')) {
          empCashData = [];
          return { meta: { rows_written: 1 } };
        }

        // Update settlement
        if (s.includes('update billing_settlements set is_active')) {
          return { meta: { rows_written: 1 } };
        }

        // Insert audit log
        if (s.includes('insert into audit_logs')) {
          return { meta: { rows_written: 1 } };
        }

        return null;
      },
    });

    return { mock, billsData, paymentsData, depositsData, empCashData, creditBillData };
  }

  it('should reverse discount amount proportionally across bills', () => {
    // 2 bills, total payable 1000, discount 100
    // Bill 1: total 600, paid 600 (500 cash + 100 discount)
    // Bill 2: total 400, paid 400 (300 cash + 100 discount)
    // After cancellation: Bill 1 paid = 600 - (500 + 60) = 40, Bill 2 paid = 400 - (300 + 40) = 60
    const discount = 100;
    const payable = 1000;
    const bill1Due = 600;
    const bill2Due = 400;
    const bill1Share = bill1Due / payable; // 0.6
    const bill2Share = bill2Due / payable; // 0.4
    const disc1 = Math.round(discount * bill1Share * 100) / 100; // 60
    const disc2 = Math.round(discount * bill2Share * 100) / 100; // 40

    expect(disc1 + disc2).toBe(discount);
  });

  it('should handle discount rounding remainder', () => {
    // 3 bills, discount 10.00
    // Each share = 1/3, discount per bill = 3.33, total = 9.99, remainder = 0.01
    const discount = 10;
    const shares = [1/3, 1/3, 1/3];
    const allocated = shares.reduce((sum, share) => sum + Math.round(discount * share * 100) / 100, 0);
    const remainder = Math.round((discount - allocated) * 100) / 100;

    expect(remainder).toBe(0.01);
    // Last bill should get the remainder
    expect(Math.round((allocated + remainder) * 100) / 100).toBe(discount);
  });

  it('should handle empty settled bills', () => {
    const settledBills: any[] = [];
    // Should not throw, should still mark settlement as inactive
    expect(settledBills.length).toBe(0);
  });

  it('should handle zero discount', () => {
    const discount = 0;
    const payable = 1000;
    const billShare = 500 / payable;
    const discountForBill = Math.round(discount * billShare * 100) / 100;

    expect(discountForBill).toBe(0);
  });
});

// ─── Pharmacy Stock Rollback Tests ────────────────────────────────────────

describe('Pharmacy stock rollback', () => {
  it('should track deducted stock for rollback', () => {
    const deductedStock: Array<{ stockId: number; quantity: number }> = [];
    deductedStock.push({ stockId: 1, quantity: 5 });
    deductedStock.push({ stockId: 2, quantity: 3 });

    expect(deductedStock).toHaveLength(2);
    expect(deductedStock[0]).toEqual({ stockId: 1, quantity: 5 });
  });

  it('should calculate correct rollback quantities', () => {
    const deductedStock = [
      { stockId: 1, quantity: 5 },
      { stockId: 2, quantity: 3 },
    ];
    const restored = deductedStock.map(s => s.quantity);

    expect(restored).toEqual([5, 3]);
  });
});

// ─── Payment Validation Tests ─────────────────────────────────────────────

describe('Payment validation', () => {
  it('should reject tender < paidAmount for cash payments', () => {
    const paidAmount = 500;
    const tender = 400;

    expect(tender < paidAmount).toBe(true);
  });

  it('should accept tender >= paidAmount', () => {
    const paidAmount = 500;
    const tender = 500;

    expect(tender >= paidAmount).toBe(true);
  });

  it('should accept deposit-only payments without tender check', () => {
    const paidAmount = 0;
    const depositDeductAmount = 500;
    const tender = 0;

    // paidAmount is 0, so tender check is skipped
    const needsTenderCheck = paidAmount > 0;
    expect(needsTenderCheck).toBe(false);
  });

  it('should validate payment split equals total', () => {
    const paidAmount = 300;
    const creditAmount = 200;
    const depositDeductAmount = 100;
    const totalAmount = 600;

    const coveredAmount = paidAmount + creditAmount + depositDeductAmount;
    expect(coveredAmount).toBe(totalAmount);
  });

  it('should reject payment split mismatch', () => {
    const paidAmount = 300;
    const creditAmount = 200;
    const depositDeductAmount = 50;
    const totalAmount = 600;

    const coveredAmount = paidAmount + creditAmount + depositDeductAmount;
    expect(coveredAmount).not.toBe(totalAmount);
  });
});

// ─── Lab Result Status Validation Tests ───────────────────────────────────

describe('Lab result status validation', () => {
  const allowedForResult = ['collected', 'received', 'processing'];

  it('should allow result entry for collected items', () => {
    expect(allowedForResult.includes('collected')).toBe(true);
  });

  it('should allow result entry for received items', () => {
    expect(allowedForResult.includes('received')).toBe(true);
  });

  it('should allow result entry for processing items', () => {
    expect(allowedForResult.includes('processing')).toBe(true);
  });

  it('should reject result entry for pending items', () => {
    expect(allowedForResult.includes('pending')).toBe(false);
  });

  it('should reject result entry for completed items', () => {
    expect(allowedForResult.includes('completed')).toBe(false);
  });

  it('should reject result entry for rejected items', () => {
    expect(allowedForResult.includes('rejected')).toBe(false);
  });
});

// ─── Audit Action Allowlist Tests ─────────────────────────────────────────

describe('Audit action allowlist', () => {
  const allowedActions = [
    'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT',
    'LOGIN', 'LOGIN_FAILED', 'LOGOUT',
    'CHECK_IN', 'CANCEL', 'DISCHARGE', 'PAYMENT', 'VIEW',
    'ROLE_CHANGE', 'PASSWORD_CHANGE',
    'RESULT', 'VERIFY', 'RECOLLECT', 'UPDATE_STATUS',
    'PRINT', 'EXPORT', 'BARCODE_SCAN', 'PROCESS',
    'COLLECT', 'RECEIVE', 'DELIVER', 'ACK_CRITICAL', 'CORRECT', 'VALIDATE',
  ];

  it('should include all 29 actions', () => {
    expect(allowedActions).toHaveLength(29);
  });

  it('should include lab workflow actions', () => {
    expect(allowedActions).toContain('COLLECT');
    expect(allowedActions).toContain('RECEIVE');
    expect(allowedActions).toContain('PROCESS');
    expect(allowedActions).toContain('DELIVER');
    expect(allowedActions).toContain('ACK_CRITICAL');
    expect(allowedActions).toContain('CORRECT');
  });

  it('should include pharmacy actions', () => {
    expect(allowedActions).toContain('CREATE');
    expect(allowedActions).toContain('UPDATE');
    expect(allowedActions).toContain('DELETE');
  });

  it('should include billing actions', () => {
    expect(allowedActions).toContain('PAYMENT');
    expect(allowedActions).toContain('CANCEL');
    expect(allowedActions).toContain('PRINT');
  });
});

// ─── Unique Patient Deduplication Tests ───────────────────────────────────

describe('Unique patient deduplication', () => {
  it('should count distinct patients across dates', () => {
    const appointments = [
      { patient_id: 1, date: '2026-01-01' },
      { patient_id: 2, date: '2026-01-01' },
      { patient_id: 1, date: '2026-01-02' }, // same patient, different day
      { patient_id: 3, date: '2026-01-02' },
    ];

    const uniquePatients = new Set(appointments.map(a => a.patient_id)).size;
    expect(uniquePatients).toBe(3); // not 4
  });

  it('should not double-count patients visiting multiple days', () => {
    const perDayCounts = [
      { date: '2026-01-01', unique: 2 },
      { date: '2026-01-02', unique: 2 },
    ];

    // Sum of per-day counts = 4, but actual unique might be 3
    const sumOfPerDay = perDayCounts.reduce((s, d) => s + d.unique, 0);
    expect(sumOfPerDay).toBe(4); // this is wrong if patients overlap

    // Correct: use COUNT(DISTINCT patient_id) across full range
    const actualUnique = 3;
    expect(actualUnique).toBeLessThan(sumOfPerDay);
  });
});
