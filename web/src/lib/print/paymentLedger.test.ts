import { describe, expect, it } from 'vitest';
import { buildInvoicePaymentLedger, formatInvoiceLedgerDateTime } from './paymentLedger';

describe('buildInvoicePaymentLedger', () => {
  it('shows the original deposit event and uses the payment date for the final payment', () => {
    const result = buildInvoicePaymentLedger({
      payments: [
        {
          id: 1534,
          amount: 33_900,
          receipt_no: 'RCP-001350',
          payment_method: 'cash',
          date: '2026-07-16 15:50:49',
          created_at: '2026-07-16 09:50:49',
        },
      ],
      depositAllocations: [
        {
          id: '98-83',
          amount: 300,
          deposit_receipt_no: 'DEP-000019',
          payment_method: 'cash',
          deposited_at: '2026-07-09 12:45:54',
        },
      ],
      isFullySettled: true,
    });

    expect(result).toEqual([
      {
        id: 'deposit-98-83',
        kind: 'deposit',
        amount: 300,
        paymentMethod: 'cash',
        reference: 'DEP-000019',
        createdAt: '2026-07-09T12:45:54Z',
        isDischargeSettlement: false,
      },
      {
        id: 'payment-1534',
        kind: 'payment',
        amount: 33_900,
        paymentMethod: 'cash',
        reference: 'RCP-001350',
        createdAt: '2026-07-16T15:50:49+06:00',
        isDischargeSettlement: true,
      },
    ]);
  });

  it('does not mark a partial payment as final payment', () => {
    const result = buildInvoicePaymentLedger({
      payments: [{ id: 1, amount: 1_000, date: '2026-07-16 09:00:00' }],
      depositAllocations: [],
      isFullySettled: false,
    });

    expect(result[0]?.isDischargeSettlement).toBe(false);
  });

  it('filters invalid amounts and uses stable ids to order equal timestamps', () => {
    const result = buildInvoicePaymentLedger({
      payments: [
        { id: 2, amount: 200, date: '2026-07-16 09:00:00' },
        { id: 1, amount: 100, date: '2026-07-16 09:00:00' },
        { id: 3, amount: 0, date: '2026-07-16 10:00:00' },
        { id: 4, amount: Number.NaN, date: '2026-07-16 11:00:00' },
      ],
      depositAllocations: [
        { id: 5, amount: -50, deposited_at: '2026-07-15 08:00:00' },
      ],
      isFullySettled: true,
    });

    expect(result.map((entry) => entry.id)).toEqual(['payment-1', 'payment-2']);
    expect(result.map((entry) => entry.isDischargeSettlement)).toEqual([false, true]);
  });
});

describe('formatInvoiceLedgerDateTime', () => {
  it('renders both UTC deposits and Bangladesh-local payments in hospital time', () => {
    expect(formatInvoiceLedgerDateTime('2026-07-09T12:45:54Z', 'en-GB'))
      .toBe('09 Jul 2026, 06:45 PM');
    expect(formatInvoiceLedgerDateTime('2026-07-16T15:50:49+06:00', 'en-GB'))
      .toBe('16 Jul 2026, 03:50 PM');
  });
});
