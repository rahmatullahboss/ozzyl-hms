import { describe, expect, it } from 'vitest';
import {
  buildLiveCreditProjection,
  buildLiveDepositApplicationProjection,
  buildLiveDepositProjection,
  buildLiveDepositRefundProjection,
  buildLiveInvoiceProjection,
  buildLivePaymentProjection,
  buildLivePaymentReversalProjection,
} from '../../src/lib/canonical/live-financial-projection';

function invoiceFixture(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: '100',
    patientId: 101,
    invoiceNo: 'INV-LIVE-1',
    currencyCode: 'BDT',
    issuedAtUtc: '2026-07-18T06:00:00.000Z',
    items: [
      {
        sourceLineId: 'line-1', serviceEventPublicId: 'evt-service-1',
        quantity: 2, unitAmount: '200.00',
      },
      {
        sourceLineId: 'line-2', serviceEventPublicId: 'evt-service-2',
        quantity: 1, unitAmount: '100.00',
      },
    ],
    ...overrides,
  };
}

function paymentFixture(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: '100',
    patientId: 101,
    paymentNo: 'PAY-LIVE-1',
    receiptNo: 'RCPT-LIVE-1',
    currencyCode: 'BDT',
    receivedAtUtc: '2026-07-18T06:05:00.000Z',
    amount: '500.00',
    tenderType: 'cash' as const,
    methodCode: 'cash',
    status: 'captured' as const,
    allocations: [{ sourceAllocationId: 'alloc-1', invoicePublicId: 'inv-live-1', amount: '450.00' }],
    ...overrides,
  };
}

describe('live tenant-scoped financial projection', () => {
  it('maps one legacy bill to stable canonical invoice and line inputs', async () => {
    const first = await buildLiveInvoiceProjection(invoiceFixture());
    const second = await buildLiveInvoiceProjection(invoiceFixture());

    expect(second).toEqual(first);
    expect(first.tenantId).toBe('100');
    expect(first.invoicePublicId).toMatch(/^inv_/);
    expect(first.lines).toHaveLength(2);
    expect(first.lines.reduce((sum, row) => sum + row.quantity * row.unitAmountMinor, 0)).toBe(50000);
  });

  it('preserves tenant example across invoice and payment projections', async () => {
    const invoice = await buildLiveInvoiceProjection(invoiceFixture({
      tenantId: '102',
      invoiceNo: 'INV-D-2026-000654',
    }));
    const payment = await buildLivePaymentProjection(paymentFixture({
      tenantId: '102',
      paymentNo: 'PAY-102-1',
      receiptNo: 'RCP-001551',
      allocations: [{
        sourceAllocationId: 'alloc-102-1',
        invoicePublicId: invoice.invoicePublicId,
        amount: '450.00',
      }],
    }));

    expect(invoice.tenantId).toBe('102');
    expect(invoice.sourceType).toBe('legacy_live_bill');
    expect(payment.tenantId).toBe('102');
    expect(payment.sourceType).toBe('legacy_live_payment');
  });

  it('maps payment totals exactly to tenders plus allocations', async () => {
    const input = await buildLivePaymentProjection(paymentFixture());
    const tenderMinor = input.tenders.reduce((sum, row) => sum + row.amountMinor, 0);
    const allocationMinor = input.allocations.reduce((sum, row) => sum + row.amountMinor, 0);

    expect(tenderMinor).toBe(allocationMinor + input.unallocatedMinor);
    expect(input.cashCustodyEventPublicId).toMatch(/^outevt_/);
  });

  it('maps deposit, adjustment, credit, and reversal identities deterministically', async () => {
    const deposit = await buildLiveDepositProjection({
      tenantId: '100', depositNo: 'DEP-1', receiptPublicId: 'receipt-1',
    });
    const application = await buildLiveDepositApplicationProjection({
      tenantId: '100', applicationNo: 'DEP-APP-1', depositPublicId: deposit.depositPublicId,
      invoicePublicId: 'invoice-1', amount: '10.00', appliedAtUtc: '2026-07-18T06:10:00.000Z',
    });
    const refund = await buildLiveDepositRefundProjection({
      tenantId: '100', refundNo: 'DEP-REF-1', depositPublicId: deposit.depositPublicId,
      amount: '5.00', tenderType: 'cash', methodCode: 'cash',
      refundedAtUtc: '2026-07-18T06:15:00.000Z',
    });
    const credit = await buildLiveCreditProjection({
      tenantId: '100', creditNo: 'CN-1', invoicePublicId: 'invoice-1', reasonCode: 'ADJUSTMENT',
      issuedAtUtc: '2026-07-18T06:20:00.000Z',
      lines: [{ sourceLineId: 'credit-line-1', amount: '3.00', reasonCode: 'ADJUSTMENT' }],
    });
    const reversal = await buildLivePaymentReversalProjection({
      tenantId: '100', reversalNo: 'REV-1', refundNo: 'REF-1', receiptPublicId: 'receipt-1',
      tenderPublicId: 'tender-1', allocationPublicId: 'allocation-1', amount: '2.00',
      reasonCode: 'REFUND', reversedAtUtc: '2026-07-18T06:25:00.000Z', tenderType: 'card',
    });

    await expect(buildLiveDepositProjection({
      tenantId: '100', depositNo: 'DEP-1', receiptPublicId: 'receipt-1',
    })).resolves.toEqual(deposit);
    expect(application.applicationPublicId).toMatch(/^depapp_/);
    expect(refund.refundPublicId).toMatch(/^refund_/);
    expect(refund.cashCustodyEventPublicId).toMatch(/^outevt_/);
    expect(credit.creditNotePublicId).toMatch(/^crnote_/);
    expect(reversal.reversalPublicId).toMatch(/^payrev_/);
  });

  it.each(['', ' 102', '102 ', '0', '-1', '1.5', '9007199254740992'])(
    'rejects invalid tenant identifier %j',
    async (tenantId) => {
      await expect(buildLiveInvoiceProjection(invoiceFixture({ tenantId }))).rejects.toThrow(
        /tenantId must be a positive decimal safe integer without surrounding whitespace/i,
      );
    },
  );

  it('rejects unsafe, floating, or unsupported source facts', async () => {
    await expect(buildLivePaymentProjection(paymentFixture({ amount: 10.001 }))).rejects.toThrow(/minor units|decimal places/i);
    await expect(buildLivePaymentProjection(paymentFixture({ amount: '100.00' }))).rejects.toThrow(/totals/i);
    await expect(buildLiveInvoiceProjection(invoiceFixture({ currencyCode: 'USD' }))).rejects.toThrow(/BDT/i);
  });
});
