import { describe, expect, it } from 'vitest';
import { buildIpdDischargeBillingProjection } from '../../src/lib/canonical/live-ipd-discharge-billing';

const NOW = '2026-07-24T02:00:00.000Z';
const DATE = '2026-07-24';

function input(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: '100',
    patientId: 501,
    admissionId: 701,
    invoiceNo: 'INV-IPD-701',
    issuedAtUtc: NOW,
    businessDate: DATE,
    dischargeMode: 'settled' as const,
    finalTotal: 900,
    globalDiscount: 100,
    provisionalItems: [{
      id: 11,
      patientId: 501,
      category: 'laboratory',
      description: 'CBC',
      department: 'Lab',
      quantity: 1,
      unitPrice: 500,
      discountAmount: 0,
      totalAmount: 500,
      doctorId: 91,
      referenceId: 301,
    }],
    package: {
      packageId: 21,
      name: 'IPD Package',
      amount: 200,
    },
    bedSegments: [{
      patientBedInfoId: 31,
      bedId: 41,
      description: 'General Ward - Bed G-01',
      amount: 300,
    }],
    requestedDepositAmount: 800,
    depositAppliedAmount: 600,
    depositRefundAmount: 200,
    paymentAmount: 300,
    paymentMethod: 'cash',
    receiptNo: 'RCP-IPD-701',
    depositAdjustmentNo: 'DAD-IPD-701',
    refundReceiptNo: 'DRF-IPD-701',
    externalTransactionId: null,
    collectorId: 9,
    counterId: 3,
    counterSessionId: 30,
    ...overrides,
  };
}

describe('buildIpdDischargeBillingProjection', () => {
  it('projects provisional, package, bed, discount, settlement, refund, and encounter authority', async () => {
    const projection = await buildIpdDischargeBillingProjection(input());
    expect(projection.invoiceSettlement.invoice).toMatchObject({
      invoiceNumber: 'INV-IPD-701',
      legacyPatientId: 501,
      sourceType: 'legacy_live_bill',
      sourceTable: 'bills',
    });
    expect(projection.invoiceSettlement.invoice.lines.map((line) => ({
      lineType: line.lineType,
      serviceEventPublicId: line.serviceEventPublicId,
      adjustmentCode: line.adjustmentCode,
      amount: line.unitAmountMinor,
    }))).toEqual([
      expect.objectContaining({ lineType: 'other_adjustment', serviceEventPublicId: null, amount: 50000 }),
      expect.objectContaining({ lineType: 'other_adjustment', serviceEventPublicId: null, amount: 20000 }),
      expect.objectContaining({ lineType: 'other_adjustment', serviceEventPublicId: null, amount: 30000 }),
      expect.objectContaining({ lineType: 'discount', serviceEventPublicId: null, amount: -10000 }),
    ]);
    expect(projection.invoiceSettlement.payment).toMatchObject({
      amountMinor: 30000,
      tenderType: 'cash',
      methodCode: 'cash',
    });
    expect(projection.invoiceSettlement.deposit).toMatchObject({ amountMinor: 60000 });
    expect(projection.depositRefund).toMatchObject({
      amountMinor: 20000,
      refundReceiptNumber: 'DRF-IPD-701',
      tenderType: 'cash',
    });
    expect(projection.encounter).toMatchObject({
      legacyAdmissionId: 701,
      legacyPatientId: 501,
      completedAtUtc: NOW,
      sourceType: 'legacy_admission_discharge',
    });
  });

  it('uses stable standard live-bill invoice and line identities', async () => {
    const first = await buildIpdDischargeBillingProjection(input());
    const second = await buildIpdDischargeBillingProjection(input());
    expect(second.invoiceSettlement.invoice.invoicePublicId).toBe(first.invoiceSettlement.invoice.invoicePublicId);
    expect(second.invoiceSettlement.invoice.lines.map((line) => line.linePublicId))
      .toEqual(first.invoiceSettlement.invoice.lines.map((line) => line.linePublicId));
    expect(new Set(first.invoiceSettlement.invoice.lines.map((line) => line.linePublicId)).size)
      .toBe(first.invoiceSettlement.invoice.lines.length);
  });

  it('requires zero due for settled mode and positive due for credit-pending mode', async () => {
    await expect(buildIpdDischargeBillingProjection(input({ paymentAmount: 200 })))
      .rejects.toThrow(/settled.*zero|zero due/i);
    await expect(buildIpdDischargeBillingProjection(input({
      dischargeMode: 'credit_pending',
      paymentAmount: 300,
      depositAppliedAmount: 500,
      requestedDepositAmount: 700,
      depositRefundAmount: 200,
    }))).resolves.toMatchObject({
      invoiceSettlement: { payment: { amountMinor: 30000 }, deposit: { amountMinor: 50000 } },
    });
    await expect(buildIpdDischargeBillingProjection(input({ dischargeMode: 'credit_pending' })))
      .rejects.toThrow(/credit.*positive due/i);
  });

  it('rejects deposit arithmetic, invoice total, duplicate identities, and non-cash without authority', async () => {
    await expect(buildIpdDischargeBillingProjection(input({ requestedDepositAmount: 900 })))
      .rejects.toThrow(/deposit.*reconcile/i);
    await expect(buildIpdDischargeBillingProjection(input({ finalTotal: 901, paymentAmount: 301 })))
      .rejects.toThrow(/invoice.*total/i);
    await expect(buildIpdDischargeBillingProjection(input({
      bedSegments: [
        { patientBedInfoId: 31, bedId: 41, description: 'Bed A', amount: 150 },
        { patientBedInfoId: 31, bedId: 42, description: 'Bed B', amount: 150 },
      ],
    }))).rejects.toThrow(/duplicate.*bed/i);
    await expect(buildIpdDischargeBillingProjection(input({
      paymentMethod: 'card',
      externalTransactionId: null,
    }))).rejects.toThrow(/transaction|reference/i);
  });
});
