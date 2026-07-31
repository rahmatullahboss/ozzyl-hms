import { describe, expect, it } from 'vitest';
import { buildDischargeFinancial } from './ipdDischargeFinancial';

describe('buildDischargeFinancial', () => {
  it('uses IP billing pending summary before admissions billing status', () => {
    const financial = buildDischargeFinancial({
      pendingSummary: {
        provisional_total: 0,
        package_total: 0,
        bed_total: 7600,
        grand_total: 7600,
        running_total: 7600,
        deposit_balance: 5000,
        net_payable: 2600,
        refund_available: 0,
      },
      billingStatus: {
        pending: { total: 0 },
        deposit_balance: 5000,
        net_payable: 0,
      },
    });

    expect(financial).toEqual({
      totalCharges: 7600,
      discountPercent: 0,
      afterDiscount: 7600,
      depositBalance: 5000,
      netPayable: 2600,
      refundAmount: 0,
      otherOutstanding: 0,
      totalPayableBeforeClearance: 2600,
      outstandingInvoices: [],
      inlineSettlementSupported: true,
      authorityMode: 'legacy',
      unresolvedServiceAmount: 0,
    });
  });

  it('falls back to admissions billing status when IP billing summary is not loaded yet', () => {
    const financial = buildDischargeFinancial({
      pendingSummary: null,
      billingStatus: {
        pending: { total: 1200 },
        deposit_balance: 200,
        net_payable: 1000,
      },
    });

    expect(financial.totalCharges).toBe(1200);
    expect(financial.depositBalance).toBe(200);
    expect(financial.netPayable).toBe(1000);
  });

  it('keeps current IPD payable separate from other open invoices', () => {
    const financial = buildDischargeFinancial({
      pendingSummary: {
        running_total: 20_000,
        deposit_balance: 20_000,
        net_payable: 0,
        pending_service_amount: 300,
      },
      billingStatus: null,
      financialClearance: {
        authority_mode: 'legacy',
        total_outstanding: 6_200,
        invoice_count: 1,
        inline_settlement_supported: true,
        invoices: [{
          invoice_number: 'LAB-0077',
          issued_at: '2026-07-19T04:00:00.000Z',
          total: 6_200,
          paid: 0,
          credited: 0,
          due: 6_200,
          legacy_bill_id: 77,
          canonical_invoice_public_id: null,
          source_label: 'Laboratory / Test',
          categories: [{ code: 'laboratory', label: 'Laboratory / Test', amount: 6_200 }],
        }],
      },
    });

    expect(financial).toMatchObject({
      netPayable: 0,
      otherOutstanding: 6_200,
      totalPayableBeforeClearance: 6_200,
      inlineSettlementSupported: true,
      authorityMode: 'legacy',
      unresolvedServiceAmount: 300,
    });
    expect(financial.outstandingInvoices[0]).toMatchObject({
      invoiceNumber: 'LAB-0077',
      due: 6_200,
      sourceLabel: 'Laboratory / Test',
      legacyBillId: 77,
    });
  });
});
