import { describe, expect, it } from 'vitest';
import { resolveBillingCounterInvoiceMode } from '../../src/lib/billing-counter-invoice-mode';

describe('resolveBillingCounterInvoiceMode', () => {
  it('normalizes a positive paid invoice with no immediate settlement to credit', () => {
    expect(resolveBillingCounterInvoiceMode({
      requestedMode: 'paid',
      total: 1900,
      paidAmount: 0,
      depositDeducted: 0,
    })).toEqual({
      requestedMode: 'paid',
      effectiveMode: 'credit',
      paidAmount: 0,
      depositDeducted: 0,
      modeAdjusted: true,
      modeAdjustmentReason: 'zero_settlement_normalized_to_credit',
    });
  });

  it('removes stale settlement values from an explicit credit invoice', () => {
    expect(resolveBillingCounterInvoiceMode({
      requestedMode: 'credit',
      total: 1900,
      paidAmount: 500,
      depositDeducted: 400,
    })).toEqual({
      requestedMode: 'credit',
      effectiveMode: 'credit',
      paidAmount: 0,
      depositDeducted: 0,
      modeAdjusted: true,
      modeAdjustmentReason: 'credit_settlement_ignored',
    });
  });

  it('preserves a partial immediate payment in paid mode', () => {
    expect(resolveBillingCounterInvoiceMode({
      requestedMode: 'paid',
      total: 1900,
      paidAmount: 500,
      depositDeducted: 0,
    })).toEqual({
      requestedMode: 'paid',
      effectiveMode: 'paid',
      paidAmount: 500,
      depositDeducted: 0,
      modeAdjusted: false,
      modeAdjustmentReason: null,
    });
  });

  it('preserves a deposit-only settlement in paid mode', () => {
    expect(resolveBillingCounterInvoiceMode({
      requestedMode: 'paid',
      total: 1900,
      paidAmount: 0,
      depositDeducted: 500,
    })).toEqual({
      requestedMode: 'paid',
      effectiveMode: 'paid',
      paidAmount: 0,
      depositDeducted: 500,
      modeAdjusted: false,
      modeAdjustmentReason: null,
    });
  });

  it('keeps a zero-net-total full-discount invoice settled in paid mode', () => {
    expect(resolveBillingCounterInvoiceMode({
      requestedMode: 'paid',
      total: 0,
      paidAmount: 0,
      depositDeducted: 0,
    })).toEqual({
      requestedMode: 'paid',
      effectiveMode: 'paid',
      paidAmount: 0,
      depositDeducted: 0,
      modeAdjusted: false,
      modeAdjustmentReason: null,
    });
  });

  it('settles an explicit zero-total credit request instead of leaving a credit invoice with no due', () => {
    expect(resolveBillingCounterInvoiceMode({
      requestedMode: 'credit',
      total: 0,
      paidAmount: 500,
      depositDeducted: 300,
    })).toEqual({
      requestedMode: 'credit',
      effectiveMode: 'paid',
      paidAmount: 0,
      depositDeducted: 0,
      modeAdjusted: true,
      modeAdjustmentReason: 'zero_total_settled',
    });
  });
});
