import { describe, expect, it } from 'vitest';
import creditNotesRoute from '../../../src/routes/tenant/creditNotes';
import billingCancellationRoute from '../../../src/routes/tenant/billingCancellation';
import settlementsRoute from '../../../src/routes/tenant/settlements';
import reportsRoute from '../../../src/routes/tenant/reports';
import { createTestApp } from '../helpers/test-app';

const TENANT_ID = 'tenant-1';

describe('Refund, discount, and cancellation report reconciliation surfaces', () => {
  it('returns a consolidated refund report reconciled to cash ledger refunds', async () => {
    const { app, mockDB } = createTestApp({
      route: reportsRoute,
      routePath: '/reports',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql) => {
        if (sql.includes('WITH refund_rows AS') && sql.includes('billing_credit_notes') && sql.includes('billing_deposits') && sql.includes('pharmacy_returns')) {
          return {
            results: [
              {
                source_type: 'credit_note',
                source_id: 1,
                refund_no: 'CN-1',
                refund_date: '2026-05-02 10:00:00',
                patient_id: 10,
                patient_name: 'Ayesha Begum',
                patient_code: 'P-10',
                invoice_no: 'INV-10',
                reason: 'Returned lab service',
                amount: 900,
                cash_amount: 900,
                payment_method: 'cash',
              },
              {
                source_type: 'deposit_refund',
                source_id: 2,
                refund_no: 'DRF-2',
                refund_date: '2026-05-02 11:00:00',
                patient_id: 11,
                patient_name: 'Karim Uddin',
                patient_code: 'P-11',
                invoice_no: null,
                reason: 'Unused advance refund',
                amount: 300,
                cash_amount: 300,
                payment_method: 'cash',
              },
              {
                source_type: 'pharmacy_return',
                source_id: 3,
                refund_no: 'RET-3',
                refund_date: '2026-05-02 12:00:00',
                patient_id: 12,
                patient_name: 'Nusrat Jahan',
                patient_code: 'P-12',
                invoice_no: 'PH-3',
                reason: 'Medicine return',
                amount: 100,
                cash_amount: 100,
                payment_method: 'cash',
              },
            ],
          };
        }
        if (sql.includes('FROM emp_cash_transactions ect') && sql.includes('SalesReturn') && sql.includes('ReturnDeposit')) {
          return {
            results: [{
              total_cash_refunds: 1300,
              sales_return_total: 1000,
              deposit_return_total: 300,
            }],
          };
        }
        return null;
      },
    });

    const res = await app.request('/reports/refunds?startDate=2026-05-01&endDate=2026-05-10');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      refunds: Array<{ sourceType: string; amount: number; cashAmount: number }>;
      summary: {
        totalRefunds: number;
        totalRefundAmount: number;
        cashRefundAmount: number;
        cashLedgerRefundTotal: number;
        cashLedgerDifference: number;
        bySourceType: Record<string, { count: number; amount: number; cashAmount: number }>;
      };
    };
    expect(body.refunds).toHaveLength(3);
    expect(body.summary).toMatchObject({
      totalRefunds: 3,
      totalRefundAmount: 1300,
      cashRefundAmount: 1300,
      cashLedgerRefundTotal: 1300,
      cashLedgerDifference: 0,
      bySourceType: {
        credit_note: { count: 1, amount: 900, cashAmount: 900 },
        deposit_refund: { count: 1, amount: 300, cashAmount: 300 },
        pharmacy_return: { count: 1, amount: 100, cashAmount: 100 },
      },
    });
    const refundSql = mockDB.queries.find((q) => q.sql.includes('WITH refund_rows AS'))?.sql ?? '';
    expect(refundSql).toContain('billing_credit_notes');
    expect(refundSql).toContain('billing_deposits');
    expect(refundSql).toContain('pharmacy_returns');
  });

  it('rejects inverted refund report date ranges before running refund SQL', async () => {
    const { app, mockDB } = createTestApp({
      route: reportsRoute,
      routePath: '/reports',
      role: 'accountant',
      tenantId: TENANT_ID,
    });

    const res = await app.request('/reports/refunds?startDate=2026-06-01&endDate=2026-05-01');
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/startDate must be on or before endDate/i);
    expect(mockDB.queries.some((q) => q.sql.includes('WITH refund_rows AS'))).toBe(false);
  });

  it('returns a consolidated discount report reconciled to discount posting events', async () => {
    const { app, mockDB } = createTestApp({
      route: reportsRoute,
      routePath: '/reports',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql) => {
        if (sql.includes('WITH discount_rows AS') && sql.includes('FROM bills b') && sql.includes('billing_settlements')) {
          return {
            results: [
              {
                source_type: 'bill_discount',
                source_id: 1,
                document_no: 'INV-1',
                discount_date: '2026-05-03 10:00:00',
                patient_id: 10,
                patient_name: 'Ayesha Begum',
                patient_code: 'P-10',
                invoice_no: 'INV-1',
                reason: 'Invoice discount',
                amount: 200,
                created_by: 1,
              },
              {
                source_type: 'settlement_discount',
                source_id: 2,
                document_no: 'STL-2',
                discount_date: '2026-05-03 11:00:00',
                patient_id: 11,
                patient_name: 'Karim Uddin',
                patient_code: 'P-11',
                invoice_no: null,
                reason: 'Settlement discount',
                amount: 300,
                created_by: 2,
              },
            ],
          };
        }
        if (sql.includes('FROM accounting_posting_events ape') && sql.includes('bill_created') && sql.includes('settlement_discount')) {
          return { results: [{ total_posted_discount: 500 }] };
        }
        if (sql.includes('FROM emp_cash_transactions ect') && sql.includes('CashDiscountGiven')) {
          return { results: [{ cash_discount_given_total: 300 }] };
        }
        return null;
      },
    });

    const res = await app.request('/reports/discounts?startDate=2026-05-01&endDate=2026-05-10');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      discounts: Array<{ sourceType: string; amount: number }>;
      summary: {
        totalDiscounts: number;
        totalDiscountAmount: number;
        postingEventDiscountTotal: number;
        postingEventDifference: number;
        cashDiscountGivenTotal: number;
        bySourceType: Record<string, { count: number; amount: number }>;
      };
    };
    expect(body.discounts).toHaveLength(2);
    expect(body.summary).toEqual({
      totalDiscounts: 2,
      totalDiscountAmount: 500,
      postingEventDiscountTotal: 500,
      postingEventDifference: 0,
      cashDiscountGivenTotal: 300,
      bySourceType: {
        bill_discount: { count: 1, amount: 200 },
        settlement_discount: { count: 1, amount: 300 },
      },
    });
    const discountSql = mockDB.queries.find((q) => q.sql.includes('WITH discount_rows AS'))?.sql ?? '';
    expect(discountSql).toContain('FROM bills b');
    expect(discountSql).toContain('billing_settlements');
  });

  it('rejects inverted discount report date ranges before running discount SQL', async () => {
    const { app, mockDB } = createTestApp({
      route: reportsRoute,
      routePath: '/reports',
      role: 'accountant',
      tenantId: TENANT_ID,
    });

    const res = await app.request('/reports/discounts?startDate=2026-06-01&endDate=2026-05-01');
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/startDate must be on or before endDate/i);
    expect(mockDB.queries.some((q) => q.sql.includes('WITH discount_rows AS'))).toBe(false);
  });

  it('returns credit note refund totals for report-to-ledger reconciliation', async () => {
    const { app } = createTestApp({
      route: creditNotesRoute,
      routePath: '/credit-notes',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql) => {
        if (sql.includes('COUNT(*) AS total_credit_notes')) {
          return {
            first: {
              total_credit_notes: 2,
              total_credit_amount: 1500.125,
              total_refund_amount: 1200.1,
            },
          };
        }
        if (sql.includes('FROM billing_credit_notes cn')) {
          return {
            results: [
              { id: 1, credit_note_no: 'CN-1', total_amount: 1000, refund_amount: 900 },
              { id: 2, credit_note_no: 'CN-2', total_amount: 500.125, refund_amount: 300.1 },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request('/credit-notes?start_date=2026-05-01&end_date=2026-05-10');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      credit_notes: unknown[];
      summary: {
        totalCreditNotes: number;
        totalCreditAmount: number;
        totalRefundAmount: number;
      };
    };
    expect(body.credit_notes).toHaveLength(2);
    expect(body.summary).toEqual({
      totalCreditNotes: 2,
      totalCreditAmount: 1500.13,
      totalRefundAmount: 1200.1,
    });
  });

  it('returns settlement payment/deposit/discount totals from the same filter set', async () => {
    const { app } = createTestApp({
      route: settlementsRoute,
      routePath: '/settlements',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql) => {
        if (sql.includes('COUNT(*) AS total_settlements')) {
          return {
            first: {
              total_settlements: 3,
              total_payable_amount: 3000,
              total_paid_amount: 1800,
              total_deposit_deducted: 700,
              total_discount_amount: 500,
              total_returned_amount: 0,
            },
          };
        }
        if (sql.includes('FROM billing_settlements s')) {
          return {
            results: [
              { id: 1, settlement_receipt_no: 'STL-1', discount_amount: 200 },
              { id: 2, settlement_receipt_no: 'STL-2', discount_amount: 300 },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request('/settlements?patient_id=10&start_date=2026-05-01');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      settlements: unknown[];
      summary: {
        totalSettlements: number;
        totalPayableAmount: number;
        totalPaidAmount: number;
        totalDepositDeducted: number;
        totalDiscountAmount: number;
        totalReturnedAmount: number;
      };
    };
    expect(body.settlements).toHaveLength(2);
    expect(body.summary).toEqual({
      totalSettlements: 3,
      totalPayableAmount: 3000,
      totalPaidAmount: 1800,
      totalDepositDeducted: 700,
      totalDiscountAmount: 500,
      totalReturnedAmount: 0,
    });
  });

  it('returns cancellation bill totals and accounting event totals including item cancellations', async () => {
    const { app } = createTestApp({
      route: billingCancellationRoute,
      routePath: '/billing-cancellation',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql) => {
        if (sql.includes('FROM accounting_posting_events e')) {
          return {
            first: {
              total_accounting_events: 3,
              total_accounting_amount: 1750,
              total_full_bill_accounting_amount: 1500,
              total_item_cancellation_amount: 250,
              posted_accounting_events: 3,
              voucher_linked_events: 3,
            },
          };
        }
        if (sql.includes('FROM bills b')) {
          return {
            results: [
              { id: 1, invoice_no: 'INV-1', amount: 1000 },
              { id: 2, invoice_no: 'INV-2', amount: 500 },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request('/billing-cancellation?start_date=2026-05-01&end_date=2026-05-10');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      cancellations: unknown[];
      summary: {
        totalCancelledBills: number;
        totalCancelledBillAmount: number;
        totalAccountingEvents: number;
        totalAccountingCancellationAmount: number;
        totalFullBillAccountingAmount: number;
        totalItemCancellationAmount: number;
        postedAccountingEvents: number;
        voucherLinkedEvents: number;
      };
    };
    expect(body.cancellations).toHaveLength(2);
    expect(body.summary).toEqual({
      totalCancelledBills: 2,
      totalCancelledBillAmount: 1500,
      totalAccountingEvents: 3,
      totalAccountingCancellationAmount: 1750,
      totalFullBillAccountingAmount: 1500,
      totalItemCancellationAmount: 250,
      postedAccountingEvents: 3,
      voucherLinkedEvents: 3,
    });
  });
});
