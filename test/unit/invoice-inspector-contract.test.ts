import { describe, expect, it } from 'vitest';
import { buildInvoiceInspectorResponse } from '../../src/services/billing/invoiceInspectorContract';

const baseInput = {
  summary: {
    billId: 92,
    invoiceNo: 'INV-92',
    status: 'paid',
    patientId: 41,
    patientName: 'Patient One',
    createdAt: '2026-07-30 10:00:00',
    grossAmount: '1200.005',
    discountAmount: 200,
    netAmount: 1000,
    paidAmount: 600,
    depositAppliedAmount: 200,
    dueAmount: 200,
  },
  items: [{
    id: 1,
    category: 'test',
    description: 'CBC',
    quantity: 1,
    rate: 1200,
    lineTotal: 1000,
  }],
  compensation: [{
    id: 'legacy:3',
    doctorId: 7,
    doctorName: 'Dr. Amina',
    sourceType: 'lab_test',
    grossAmount: 1000,
    discountAmount: 200,
    performerReserveAmount: 100,
    eligibleBaseAmount: 700,
    earnedAmount: 100,
    waiverAmount: 20,
    adjustmentAmount: 0,
    payableAmount: 80,
    paidAmount: 30,
    outstandingAmount: 50,
    status: 'partially_paid',
    reasonCode: 'doctor_waived',
  }],
  warnings: ['Discount allocation source is partial.'],
} as const;

describe('invoice inspector response contract', () => {
  it('normalizes numbers to finite two-decimal values and optional arrays to empty arrays', () => {
    const response = buildInvoiceInspectorResponse({
      ...baseInput,
      payments: undefined,
      deposits: undefined,
      discounts: undefined,
      audit: undefined,
      summary: {
        ...baseInput.summary,
        grossAmount: '1200.005',
        paidAmount: Number.NaN,
      },
    });

    expect(response.summary).toMatchObject({
      grossAmount: 1200.01,
      discountAmount: 200,
      netAmount: 1000,
      paidAmount: 0,
      depositAppliedAmount: 200,
      dueAmount: 200,
    });
    expect(response.payments).toEqual([]);
    expect(response.deposits).toEqual([]);
    expect(response.discounts).toEqual([]);
    expect(response.audit).toEqual([]);
  });

  it('reconciles invoice gross minus discount against net', () => {
    const response = buildInvoiceInspectorResponse(baseInput);
    expect(response.reconciliation.invoice).toEqual({
      grossAmount: 1200.01,
      discountAmount: 200,
      expectedNetAmount: 1000.01,
      netAmount: 1000,
      difference: 0.01,
      status: 'reconciled',
    });
  });

  it('reconciles payments plus deposit applied against settled and due amounts', () => {
    const response = buildInvoiceInspectorResponse({
      ...baseInput,
      payments: [{ id: 1, amount: 600 }],
      deposits: [{ id: 2, amount: 200, adjustmentType: 'applied' }],
    });
    expect(response.reconciliation.settlement).toEqual({
      paymentAmount: 600,
      depositAppliedAmount: 200,
      settledAmount: 800,
      expectedSettledAmount: 800,
      dueAmount: 200,
      difference: 0,
      status: 'reconciled',
    });
  });

  it('reconciles compensation payable, paid, and outstanding measures', () => {
    const response = buildInvoiceInspectorResponse(baseInput);
    expect(response.reconciliation.compensation).toEqual({
      payableAmount: 80,
      paidAmount: 30,
      outstandingAmount: 50,
      difference: 0,
      status: 'reconciled',
    });
  });

  it('preserves valid sections while appending reconciliation warnings', () => {
    const response = buildInvoiceInspectorResponse({
      ...baseInput,
      summary: { ...baseInput.summary, netAmount: 900 },
    });
    expect(response.items).toHaveLength(1);
    expect(response.compensation).toHaveLength(1);
    expect(response.warnings).toEqual(expect.arrayContaining([
      'Discount allocation source is partial.',
      'Invoice gross less discount differs from net by BDT 100.01.',
    ]));
  });
});
