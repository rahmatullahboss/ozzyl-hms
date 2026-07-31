import { describe, expect, it } from 'vitest';
import {
  buildProvisionalInvoiceProjection,
  buildProvisionalSettlementProjection,
} from '../../src/lib/canonical/live-provisional-billing';
import { buildLegacyLiveInvoiceSourceLineId } from '../../src/lib/canonical/live-invoice-line-identity';
import { createDeterministicSourceId } from '../../src/lib/canonical/source-mapping';

const ISSUED_AT = '2026-07-23T12:00:00.000Z';
const BUSINESS_DATE = '2026-07-23';

function baseInput() {
  return {
    tenantId: '100',
    patientId: 501,
    invoiceNo: 'INV-PROV-1',
    issuedAtUtc: ISSUED_AT,
    businessDate: BUSINESS_DATE,
    globalDiscount: 50,
    items: [{
      provisionalItemId: 901,
      patientId: 501,
      visitId: 601,
      admissionId: null,
      category: 'test',
      description: 'CBC',
      department: 'Laboratory',
      quantity: 2,
      unitPrice: 500,
      discountAmount: 100,
      totalAmount: 900,
      doctorId: 101,
      doctorName: 'Dr Test',
      referenceId: 55,
      isManual: false,
    }],
  };
}

describe('live provisional billing projection', () => {
  it('projects gross items, item discount, and global discount with standard live-bill identities', async () => {
    const projection = await buildProvisionalInvoiceProjection(baseInput());
    const sourceLineId = buildLegacyLiveInvoiceSourceLineId({
      lineNumber: 1,
      itemCategory: 'test',
      referenceId: 55,
    });

    expect(projection.invoicePublicId).toBe(await createDeterministicSourceId(
      'inv', '100', 'legacy_live_bill', 'INV-PROV-1',
    ));
    expect(projection.lines[0].linePublicId).toBe(await createDeterministicSourceId(
      'invline', '100', 'legacy_live_bill_line', `INV-PROV-1:${sourceLineId}`,
    ));
    expect(projection.lines).toEqual([
      expect.objectContaining({
        lineType: 'other_adjustment',
        serviceEventPublicId: null,
        adjustmentCode: 'PROVISIONAL_TEST',
        quantity: 1,
        unitAmountMinor: 100_000,
      }),
      expect.objectContaining({
        lineType: 'discount',
        serviceEventPublicId: null,
        adjustmentCode: 'PROVISIONAL_ITEM_DISCOUNT',
        quantity: 1,
        unitAmountMinor: -10_000,
      }),
      expect.objectContaining({
        lineType: 'discount',
        serviceEventPublicId: null,
        adjustmentCode: 'PROVISIONAL_GLOBAL_DISCOUNT',
        quantity: 1,
        unitAmountMinor: -5_000,
      }),
    ]);
    expect(projection.lines.reduce((sum, line) => sum + line.quantity * line.unitAmountMinor, 0)).toBe(85_000);
    expect(projection).toMatchObject({
      sourceType: 'legacy_live_bill',
      sourcePublicId: 'INV-PROV-1',
      sourceTable: 'bills',
      legacyPatientId: 501,
      currencyCode: 'BDT',
    });
  });

  it('rejects provisional item gross, discount, and net mismatches', async () => {
    await expect(buildProvisionalInvoiceProjection({
      ...baseInput(),
      items: [{ ...baseInput().items[0], totalAmount: 899 }],
    })).rejects.toThrow(/gross, discount, and net total do not reconcile/i);
  });

  it('rejects duplicate items, cross-patient items, and non-positive final totals', async () => {
    const item = baseInput().items[0];
    await expect(buildProvisionalInvoiceProjection({
      ...baseInput(), items: [item, item],
    })).rejects.toThrow(/duplicate provisional item/i);
    await expect(buildProvisionalInvoiceProjection({
      ...baseInput(), items: [{ ...item, patientId: 999 }],
    })).rejects.toThrow(/patient mismatch/i);
    await expect(buildProvisionalInvoiceProjection({
      ...baseInput(), globalDiscount: 900, items: [{ ...item, discountAmount: 100, totalAmount: 900 }],
    })).rejects.toThrow(/net total must be positive/i);
  });

  it('keeps manual item evidence financial-only without a fabricated service event', async () => {
    const projection = await buildProvisionalInvoiceProjection({
      ...baseInput(),
      globalDiscount: 0,
      items: [{
        ...baseInput().items[0],
        referenceId: null,
        doctorId: null,
        doctorName: null,
        isManual: true,
        category: 'manual_charge',
        description: 'Manual oxygen charge',
      }],
    });
    expect(projection.lines[0]).toMatchObject({
      lineType: 'other_adjustment',
      serviceEventPublicId: null,
      adjustmentCode: 'PROVISIONAL_MANUAL_CHARGE',
    });
  });

  it('projects credit, deposit-only, and combined settlement authority', async () => {
    const credit = await buildProvisionalSettlementProjection({
      ...baseInput(),
      globalDiscount: 0,
      paymentAmount: 0,
      depositAmount: 0,
      paymentMethod: 'credit',
      receiptNo: null,
      depositAdjustmentNo: null,
      collectorId: 9,
      counterId: 3,
      counterSessionId: 30,
    });
    expect(credit).toMatchObject({ payment: null, deposit: null });

    const depositOnly = await buildProvisionalSettlementProjection({
      ...baseInput(),
      globalDiscount: 0,
      paymentAmount: 0,
      depositAmount: 300,
      paymentMethod: 'credit',
      receiptNo: null,
      depositAdjustmentNo: 'DAD-PROV-1',
      collectorId: 9,
      counterId: 3,
      counterSessionId: 30,
    });
    expect(depositOnly.deposit).toMatchObject({
      adjustmentNumber: 'DAD-PROV-1',
      amountMinor: 30_000,
      sourceType: 'legacy_live_deposit',
      sourceTable: 'billing_deposits',
    });
    expect(depositOnly.payment).toBeNull();

    const combined = await buildProvisionalSettlementProjection({
      ...baseInput(),
      globalDiscount: 0,
      paymentAmount: 200,
      depositAmount: 300,
      paymentMethod: 'cash',
      receiptNo: 'RCP-PROV-1',
      depositAdjustmentNo: 'DAD-PROV-1',
      collectorId: 9,
      counterId: 3,
      counterSessionId: 30,
    });
    expect(combined.commandIdempotencyKey).toBe('provisional_settlement:INV-PROV-1:RCP-PROV-1:DAD-PROV-1');
    expect(combined.payment).toMatchObject({
      receiptNumber: 'RCP-PROV-1',
      tenderType: 'cash',
      methodCode: 'cash',
      amountMinor: 20_000,
      externalTransactionId: null,
      legacyCollectorId: 9,
      legacyCounterId: 3,
      legacyCounterSessionId: 30,
    });
    expect(combined.deposit).toMatchObject({ adjustmentNumber: 'DAD-PROV-1', amountMinor: 30_000 });
    expect(combined.payment?.cashCustodyEventPublicId).toBeTruthy();
  });

  it.each([
    ['cash', 'cash'],
    ['card', 'card'],
    ['bKash', 'mobile_wallet'],
    ['Nagad', 'mobile_wallet'],
    ['Rocket', 'mobile_wallet'],
    ['bank transfer', 'bank_transfer'],
    ['cheque', 'bank_transfer'],
    ['online gateway', 'gateway'],
    ['other', 'other'],
  ] as const)('maps %s to %s tender authority', async (paymentMethod, tenderType) => {
    const nonCash = tenderType !== 'cash';
    const projection = await buildProvisionalSettlementProjection({
      ...baseInput(),
      globalDiscount: 0,
      paymentAmount: 900,
      depositAmount: 0,
      paymentMethod,
      externalTransactionId: nonCash ? `TX-${paymentMethod}` : null,
      receiptNo: 'RCP-METHOD-1',
      depositAdjustmentNo: null,
      collectorId: 9,
      counterId: 3,
      counterSessionId: 30,
    });
    expect(projection.payment).toMatchObject({ tenderType });
  });

  it('requires receipt and non-cash transaction authority only when payment exists', async () => {
    await expect(buildProvisionalSettlementProjection({
      ...baseInput(),
      globalDiscount: 0,
      paymentAmount: 100,
      depositAmount: 0,
      paymentMethod: 'cash',
      receiptNo: null,
      depositAdjustmentNo: null,
      collectorId: 9,
      counterId: 3,
      counterSessionId: 30,
    })).rejects.toThrow(/receipt/i);
    await expect(buildProvisionalSettlementProjection({
      ...baseInput(),
      globalDiscount: 0,
      paymentAmount: 100,
      depositAmount: 0,
      paymentMethod: 'card',
      externalTransactionId: null,
      receiptNo: 'RCP-NONCASH-1',
      depositAdjustmentNo: null,
      collectorId: 9,
      counterId: 3,
      counterSessionId: 30,
    })).rejects.toThrow(/transaction\/reference authority/i);
  });
});
