import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

type PaymentMethodResponse = {
  reportKey: string;
  period: { startDate: string; endDate: string };
  dateBasis: string;
  totalCollection: number;
  transactionCount: number;
  methods: Array<{ key: string; label: string; amount: number; count: number; percentage: number }>;
  depositReceipts: number;
  depositMethods: Array<{ key: string; amount: number; count: number }>;
  reconciliation: { status: string; summaryTotal: number; detailTotal: number };
};

describe('dashboard range payment methods', () => {
  it('normalizes billing payment methods and keeps deposit receipts separate', async () => {
    let billingParams: unknown[] = [];
    let depositParams: unknown[] = [];
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        if (lower.includes('dashboard_payment_methods:billing')) {
          billingParams = params;
          expect(lower).toContain("'+6 hours'");
          expect(lower).toContain('case');
          return {
            results: [
              { method_key: 'cash', method_label: 'Cash', amount: 400, row_count: 2 },
              { method_key: 'bkash', method_label: 'bKash', amount: 200, row_count: 1 },
              { method_key: 'nagad', method_label: 'Nagad', amount: 100, row_count: 1 },
              { method_key: 'card', method_label: 'Card', amount: 50, row_count: 1 },
              { method_key: 'bank_transfer', method_label: 'Bank Transfer', amount: 25, row_count: 1 },
              { method_key: 'cheque', method_label: 'Cheque', amount: 10, row_count: 1 },
              { method_key: 'unknown', method_label: 'Unknown', amount: 5, row_count: 1 },
            ],
          };
        }
        if (lower.includes('dashboard_payment_methods:deposits')) {
          depositParams = params;
          return {
            results: [
              { method_key: 'cash', method_label: 'Cash', amount: 300, row_count: 2 },
              { method_key: 'bkash', method_label: 'bKash', amount: 100, row_count: 1 },
            ],
          };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/payment-methods?startDate=2026-07-01&endDate=2026-07-31');
    expect(response.status).toBe(200);
    const body = await response.json() as PaymentMethodResponse;

    expect(body).toMatchObject({
      reportKey: 'admin_payment_methods',
      period: { startDate: '2026-07-01', endDate: '2026-07-31' },
      dateBasis: 'payment_date',
      totalCollection: 790,
      transactionCount: 8,
      depositReceipts: 400,
    });
    expect(body.methods.map((method) => method.key)).toEqual([
      'cash', 'bkash', 'nagad', 'card', 'bank_transfer', 'cheque', 'unknown',
    ]);
    expect(body.methods[0]).toMatchObject({ amount: 400, count: 2, percentage: 50.63 });
    expect(body.depositMethods).toEqual([
      { key: 'cash', label: 'Cash', amount: 300, count: 2 },
      { key: 'bkash', label: 'bKash', amount: 100, count: 1 },
    ]);
    expect(body.reconciliation).toMatchObject({
      status: 'reconciled',
      summaryTotal: 790,
      detailTotal: 790,
    });
    expect(billingParams).toEqual(['tenant-1', '2026-07-01', '2026-07-31']);
    expect(depositParams).toEqual(['tenant-1', '2026-07-01', '2026-07-31']);
  });

  it('rejects invalid ranges', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });
    const response = await app.request('/dashboard/payment-methods?startDate=2026-08-01&endDate=2026-07-01');
    expect(response.status).toBe(400);
  });
});
