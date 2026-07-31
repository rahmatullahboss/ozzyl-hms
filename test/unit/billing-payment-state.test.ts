import { describe, expect, it } from 'vitest';
import {
  calculateBillPaymentState,
  calculatePaymentGuardOutstanding,
} from '../../src/lib/billing-payment-state';

describe('billing payment state', () => {
  it('subtracts deposit deductions from outstanding due', () => {
    expect(calculateBillPaymentState({
      total: 1700,
      depositDeducted: 1000,
      paidAmount: 700,
    })).toEqual({
      paid: 700,
      depositDeducted: 1000,
      due: 0,
      status: 'paid',
      settledAmount: 1700,
    });
  });

  it('normalizes sub-cent floating-point residue before deriving settlement state', () => {
    expect(calculateBillPaymentState({
      total: 1200.0000000000002,
      paidAmount: 1200,
      depositDeducted: 0,
    })).toEqual({
      paid: 1200,
      depositDeducted: 0,
      due: 0,
      status: 'paid',
      settledAmount: 1200,
    });
    expect(calculatePaymentGuardOutstanding({
      total: 1200.0000000000002,
      paidAmount: 1200,
      depositDeducted: 0,
    })).toBe(0);
  });

  it('marks bills partially paid when payment or deposit covers part of the total', () => {
    expect(calculateBillPaymentState({
      total: 1700,
      depositDeducted: 500,
      paidAmount: 0,
    })).toMatchObject({
      due: 1200,
      status: 'partially_paid',
      settledAmount: 500,
    });
  });

  it('caps deposit deduction to the bill total', () => {
    expect(calculateBillPaymentState({
      total: 1000,
      depositDeducted: 5000,
      paidAmount: 0,
    })).toEqual({
      paid: 0,
      depositDeducted: 1000,
      due: 0,
      status: 'paid',
      settledAmount: 1000,
    });
  });

  it('caps cash payment to the remaining payable after deposit', () => {
    expect(calculateBillPaymentState({
      total: 1700,
      depositDeducted: 500,
      paidAmount: 5000,
    })).toEqual({
      paid: 1200,
      depositDeducted: 500,
      due: 0,
      status: 'paid',
      settledAmount: 1700,
    });
  });

  it('treats bill total as net payable when guarding due payments', () => {
    expect(calculatePaymentGuardOutstanding({
      total: 4500,
      discount: 500,
      paidAmount: 0,
      depositDeducted: 0,
    })).toBe(4500);
  });
});
