import { describe, expect, it } from 'vitest';
import { resolveBillingInvoiceSubmissionMode } from './billingInvoiceMode';

describe('resolveBillingInvoiceSubmissionMode', () => {
  it('submits positive zero-settlement Pay now invoices as credit', () => {
    expect(resolveBillingInvoiceSubmissionMode({
      selectedMode: 'paid',
      total: 1900,
      paidAmount: 0,
      depositDeducted: 0,
    })).toEqual({
      effectiveMode: 'credit',
      paidAmount: 0,
      depositDeducted: 0,
      adjustedToCredit: true,
    });
  });

  it('removes settlement values from credit and provisional submissions', () => {
    expect(resolveBillingInvoiceSubmissionMode({
      selectedMode: 'credit',
      total: 1900,
      paidAmount: 500,
      depositDeducted: 300,
    })).toEqual({
      effectiveMode: 'credit',
      paidAmount: 0,
      depositDeducted: 0,
      adjustedToCredit: false,
    });

    expect(resolveBillingInvoiceSubmissionMode({
      selectedMode: 'provisional',
      total: 1900,
      paidAmount: 500,
      depositDeducted: 300,
    })).toEqual({
      effectiveMode: 'provisional',
      paidAmount: 0,
      depositDeducted: 0,
      adjustedToCredit: false,
    });
  });

  it('preserves partial and deposit-only Pay now settlements', () => {
    expect(resolveBillingInvoiceSubmissionMode({
      selectedMode: 'paid',
      total: 1900,
      paidAmount: 500,
      depositDeducted: 0,
    })).toMatchObject({ effectiveMode: 'paid', paidAmount: 500, depositDeducted: 0 });

    expect(resolveBillingInvoiceSubmissionMode({
      selectedMode: 'paid',
      total: 1900,
      paidAmount: 0,
      depositDeducted: 500,
    })).toMatchObject({ effectiveMode: 'paid', paidAmount: 0, depositDeducted: 500 });
  });

  it('keeps a zero-total full-discount Pay now invoice paid', () => {
    expect(resolveBillingInvoiceSubmissionMode({
      selectedMode: 'paid',
      total: 0,
      paidAmount: 0,
      depositDeducted: 0,
    })).toEqual({
      effectiveMode: 'paid',
      paidAmount: 0,
      depositDeducted: 0,
      adjustedToCredit: false,
    });
  });

  it('settles an explicit zero-total credit selection as paid with no settlement transaction', () => {
    expect(resolveBillingInvoiceSubmissionMode({
      selectedMode: 'credit',
      total: 0,
      paidAmount: 500,
      depositDeducted: 300,
    })).toEqual({
      effectiveMode: 'paid',
      paidAmount: 0,
      depositDeducted: 0,
      adjustedToCredit: false,
    });
  });
});
