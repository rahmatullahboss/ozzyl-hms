import { describe, expect, it } from 'vitest';
import type { ReceivableRecord } from '../../src/services/actionCenter/collections/types';
import {
  summarizePatientOutstandingReceivables,
  type LegacyInvoiceFinancialMetadata,
} from '../../src/lib/ipd-discharge-financial-clearance';

function receivable(overrides: Partial<ReceivableRecord> = {}): ReceivableRecord {
  return {
    source: { sourceType: 'invoice', legacyBillId: 10 },
    invoiceNumber: 'INV-10',
    patientId: 1,
    patientName: 'Marufa',
    patientMobile: '01700000000',
    currencyCode: 'BDT',
    totalMinor: 620_000,
    paidMinor: 0,
    creditedMinor: 0,
    dueMinor: 620_000,
    issuedAtUtc: '2026-07-19T08:00:00.000Z',
    financialStatus: 'open',
    ...overrides,
  };
}

describe('IPD discharge financial clearance', () => {
  it('summarizes every open invoice for the selected patient with legacy category details', () => {
    const metadata = new Map<number, LegacyInvoiceFinancialMetadata>([
      [10, {
        legacyBillId: 10,
        admissionId: null,
        visitId: 55,
        testAmountMinor: 500_000,
        consultationAmountMinor: 120_000,
        admissionAmountMinor: 0,
        operationAmountMinor: 0,
        pharmacyAmountMinor: 0,
      }],
      [11, {
        legacyBillId: 11,
        admissionId: 22,
        visitId: null,
        testAmountMinor: 0,
        consultationAmountMinor: 0,
        admissionAmountMinor: 80_000,
        operationAmountMinor: 0,
        pharmacyAmountMinor: 20_000,
      }],
    ]);

    const result = summarizePatientOutstandingReceivables({
      authorityMode: 'legacy',
      patientId: 1,
      receivables: [
        receivable(),
        receivable({
          source: { sourceType: 'invoice', legacyBillId: 11 },
          invoiceNumber: 'INV-11',
          totalMinor: 100_000,
          paidMinor: 0,
          dueMinor: 100_000,
        }),
        receivable({
          source: { sourceType: 'invoice', legacyBillId: 12 },
          patientId: 2,
          patientName: 'Other Patient',
          dueMinor: 90_000,
        }),
        receivable({
          source: { sourceType: 'invoice', legacyBillId: 13 },
          invoiceNumber: 'INV-PAID',
          financialStatus: 'paid',
          dueMinor: 0,
        }),
      ],
      legacyMetadataByBillId: metadata,
    });

    expect(result.authorityMode).toBe('legacy');
    expect(result.totalOutstandingMinor).toBe(720_000);
    expect(result.invoiceCount).toBe(2);
    expect(result.inlineSettlementSupported).toBe(true);
    expect(result.invoices[0]).toMatchObject({
      invoiceNumber: 'INV-10',
      dueMinor: 620_000,
      sourceLabel: 'Mixed invoice',
      legacyBillId: 10,
    });
    expect(result.invoices[0].categories).toEqual([
      { code: 'laboratory', label: 'Laboratory / Test', amountMinor: 500_000 },
      { code: 'consultation', label: 'OPD / Consultation', amountMinor: 120_000 },
    ]);
    expect(result.invoices[1].categories).toEqual([
      { code: 'admission', label: 'IPD / Admission', amountMinor: 80_000 },
      { code: 'pharmacy', label: 'Pharmacy', amountMinor: 20_000 },
    ]);
  });

  it('fails closed for inline settlement when canonical authority has an unmapped invoice', () => {
    const result = summarizePatientOutstandingReceivables({
      authorityMode: 'canonical',
      patientId: 1,
      receivables: [receivable({
        source: { sourceType: 'invoice', canonicalInvoicePublicId: 'invoice-01JXYZ' },
      })],
      legacyMetadataByBillId: new Map(),
    });

    expect(result.inlineSettlementSupported).toBe(false);
    expect(result.invoices[0]).toMatchObject({
      canonicalInvoicePublicId: 'invoice-01JXYZ',
      legacyBillId: null,
      sourceLabel: 'Other invoice',
    });
    expect(result.invoices[0].categories).toEqual([
      { code: 'other', label: 'Other', amountMinor: 620_000 },
    ]);
  });

  it('keeps different currencies separate instead of adding incompatible balances', () => {
    expect(() => summarizePatientOutstandingReceivables({
      authorityMode: 'canonical',
      patientId: 1,
      receivables: [
        receivable(),
        receivable({
          source: { sourceType: 'invoice', canonicalInvoicePublicId: 'invoice-usd' },
          currencyCode: 'USD',
        }),
      ],
      legacyMetadataByBillId: new Map(),
    })).toThrow('multiple currencies');
  });
});
