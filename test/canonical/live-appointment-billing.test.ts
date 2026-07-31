import { describe, expect, it } from 'vitest';
import {
  buildAppointmentFullPaymentProjection,
  buildAppointmentInvoiceProjection,
  type AppointmentInvoiceProjectionInput,
} from '../../src/lib/canonical/live-appointment-billing';
import { buildLiveInvoiceProjection } from '../../src/lib/canonical/live-financial-projection';
import { buildLegacyLiveInvoiceSourceLineId } from '../../src/lib/canonical/live-invoice-line-identity';

const NOW = '2026-07-23T12:00:00.000Z';
const DATE = '2026-07-23';

function input(overrides: Partial<AppointmentInvoiceProjectionInput> = {}): AppointmentInvoiceProjectionInput {
  const base: AppointmentInvoiceProjectionInput = {
    tenantId: '100',
    appointmentId: 77,
    patientId: 501,
    invoiceNo: 'INV-A-1',
    issuedAtUtc: NOW,
    businessDate: DATE,
    items: [{
      provisionalItemId: 901,
      category: 'doctor_visit',
      description: 'Consultation - Dr. Aminul',
      quantity: 1,
      unitPrice: 1000,
      discountAmount: 300,
      totalAmount: 700,
      doctorId: 101,
      referenceId: 101,
    }],
  };
  return { ...base, ...overrides, items: overrides.items ?? base.items };
}

function projectedTotalMinor(lines: Awaited<ReturnType<typeof buildAppointmentInvoiceProjection>>['lines']): number {
  return lines.reduce((total, line) => total + line.quantity * line.unitAmountMinor, 0);
}

describe('live appointment billing projection', () => {
  it('projects gross appointment items and one discount without inventing service authority', async () => {
    const projection = await buildAppointmentInvoiceProjection(input());

    expect(projection.lines).toHaveLength(2);
    expect(projection.lines[0]).toMatchObject({
      lineType: 'other_adjustment',
      adjustmentCode: 'APPOINTMENT_DOCTOR_VISIT',
      quantity: 1,
      unitAmountMinor: 100_000,
      serviceEventPublicId: null,
    });
    expect(projection.lines[1]).toMatchObject({
      lineType: 'discount',
      adjustmentCode: 'APPOINTMENT_DISCOUNT',
      quantity: 1,
      unitAmountMinor: -30_000,
      serviceEventPublicId: null,
    });
    expect(projectedTotalMinor(projection.lines)).toBe(70_000);
    expect(JSON.stringify(projection.lines)).not.toContain('serviceEventPublicId":"101');
    expect(projection.sourceType).toBe('legacy_live_bill');
    expect(projection.sourcePublicId).toBe('INV-A-1');
  });

  it('returns stable identities for the same appointment authority', async () => {
    const first = await buildAppointmentInvoiceProjection(input());
    const second = await buildAppointmentInvoiceProjection(input());
    expect(second).toEqual(first);
  });

  it('uses the standard live-bill invoice and line identities required by compensation projection', async () => {
    const appointmentProjection = await buildAppointmentInvoiceProjection(input());
    const sourceLineId = buildLegacyLiveInvoiceSourceLineId({
      lineNumber: 1,
      itemCategory: 'doctor_visit',
      referenceId: 101,
    });
    const liveProjection = await buildLiveInvoiceProjection({
      tenantId: '100',
      patientId: 501,
      invoiceNo: 'INV-A-1',
      currencyCode: 'BDT',
      issuedAtUtc: NOW,
      items: [{
        sourceLineId,
        lineType: 'other_adjustment',
        adjustmentCode: 'APPOINTMENT_DOCTOR_VISIT',
        quantity: 1,
        unitAmount: 1000,
      }],
      discount: 300,
    });

    expect(appointmentProjection.invoicePublicId).toBe(liveProjection.invoicePublicId);
    expect(appointmentProjection.lines[0].linePublicId).toBe(liveProjection.lines[0].linePublicId);
    expect(appointmentProjection.sourceType).toBe('legacy_live_bill');
    expect(appointmentProjection.sourcePublicId).toBe('INV-A-1');
  });

  it.each([
    ['cash', 'cash', null, 'cash'],
    ['card', 'card', 'CARD-1', 'card'],
    ['bkash', 'mobile_wallet', 'BKASH-1', 'bkash'],
    ['nagad', 'mobile_wallet', 'NAGAD-1', 'nagad'],
    ['rocket', 'mobile_wallet', 'ROCKET-1', 'rocket'],
    ['bank_transfer', 'bank_transfer', 'BANK-1', 'bank_transfer'],
    ['bank', 'bank_transfer', 'BANK-2', 'bank'],
    ['cheque', 'bank_transfer', 'CHEQUE-1', 'cheque'],
    ['other', 'other', 'OTHER-1', 'other'],
  ] as const)('maps %s to canonical %s authority', async (
    paymentMethod,
    expectedTenderType,
    externalTransactionId,
    expectedMethodCode,
  ) => {
    const projection = await buildAppointmentFullPaymentProjection({
      ...input(),
      receiptNo: `RCP-${paymentMethod}`,
      paymentMethod,
      externalTransactionId,
      collectorId: 9,
      counterId: 3,
      counterSessionId: 30,
      amount: 700,
    });

    expect(projection.payment).toMatchObject({
      tenderType: expectedTenderType,
      methodCode: expectedMethodCode,
      amountMinor: 70_000,
      externalTransactionId,
    });
    expect(projection.payment.cashCustodyEventPublicId == null).toBe(paymentMethod !== 'cash');
  });

  it('rejects non-cash payment without transaction or reference authority', async () => {
    await expect(buildAppointmentFullPaymentProjection({
      ...input(),
      receiptNo: 'RCP-CARD',
      paymentMethod: 'card',
      externalTransactionId: null,
      collectorId: 9,
      counterId: 3,
      counterSessionId: 30,
      amount: 700,
    })).rejects.toThrow(/transaction\/reference/i);
  });

  it('rejects inconsistent gross, discount, and net item totals', async () => {
    await expect(buildAppointmentInvoiceProjection(input({
      items: [{
        ...input().items[0],
        totalAmount: 650,
      }],
    }))).rejects.toThrow(/net total/i);
  });
});
