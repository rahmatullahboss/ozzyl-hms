import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

describe('dashboard KPI breakdown drilldowns', () => {
  it('returns source and transaction rows for accounting income', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('group by source_label') && lower.includes('from payment_allocations')) {
          return {
            results: [
              { source_label: 'OPD', amount: 700, row_count: 2 },
              { source_label: 'Lab', amount: 300, row_count: 1 },
            ],
          };
        }
        if (lower.includes("'payment' as source_type") && lower.includes('from payment_allocations pa')) {
          return {
            results: [{
              id: 'payment-1',
              occurred_at: '2026-06-13 10:00:00',
              source_type: 'payment',
              source_label: 'OPD',
              reference_no: 'INV-1',
              counter_name: 'Main Counter',
              user_name: 'Cashier A',
              amount: 700,
              status: 'posted',
              discount_reference: 'Reference Doctor Less',
              discount_amount: 400,
            }],
          };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/kpi-breakdown?metric=accounting_income&date=2026-06-13');

    expect(response.status).toBe(200);
    const body = await response.json() as {
      metric: string;
      title: string;
      total: number;
      period: { startDate: string; endDate: string; label: string };
      sources: Array<{ label: string; amount: number; count: number }>;
      rows: Array<{ id: string; referenceNo: string; amount: number; userName: string; discountReference?: string; discountAmount?: number }>;
    };
    expect(body).toMatchObject({
      metric: 'accounting_income',
      title: 'Total Collection',
      total: 1000,
      period: { startDate: '2026-06-13', endDate: '2026-06-13', label: '2026-06-13' },
    });
    expect(body.sources).toEqual([
      { label: 'OPD', amount: 700, count: 2 },
      { label: 'Lab', amount: 300, count: 1 },
    ]);
    expect(body.rows[0]).toMatchObject({ id: 'payment-1', referenceNo: 'INV-1', amount: 700, userName: 'Cashier A', discountReference: 'Reference Doctor Less', discountAmount: 400 });
    expect(mockDB.queries.some((query) => query.sql.includes('FROM payments'))).toBe(true);
  });

  it('includes patient deposit receipts in the Total Collection drilldown', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('group by source_label') && lower.includes('from payment_allocations')) {
          return { results: [{ source_label: 'OPD', amount: 14_700, row_count: 12 }] };
        }
        if (lower.includes("'payment' as source_type") && lower.includes('from payment_allocations pa')) {
          return {
            results: [{
              id: 'payment-1',
              occurred_at: '2026-06-13 10:00:00',
              source_type: 'payment',
              source_label: 'OPD',
              reference_no: 'PAY-1',
              counter_name: 'Main Counter',
              user_name: 'Cashier A',
              amount: 14_700,
              status: 'posted',
            }],
          };
        }
        if (lower.includes('from billing_deposits d') && lower.includes('group by source_label')) {
          return { results: [{ source_label: 'deposit_collection', amount: 300, row_count: 1 }] };
        }
        if (lower.includes('from billing_deposits d') && lower.includes("'deposit_collection' as source_type")) {
          return {
            results: [{
              id: 'deposit-1',
              occurred_at: '2026-06-13 11:00:00',
              source_type: 'deposit_collection',
              source_label: 'deposit_collection',
              reference_no: 'DEP-1',
              counter_name: 'Main Counter',
              user_name: 'Cashier A',
              amount: 300,
              status: 'posted',
            }],
          };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/kpi-breakdown?metric=accounting_income&date=2026-06-13');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      total: number;
      sources: Array<{ label: string; amount: number; count: number }>;
      rows: Array<{ sourceType: string; sourceLabel: string; amount: number; referenceNo: string }>;
    };

    expect(body.total).toBe(15_000);
    expect(body.sources).toEqual([
      { label: 'OPD', amount: 14_700, count: 12 },
      { label: 'deposit_collection', amount: 300, count: 1 },
    ]);
    expect(body.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: 'payment', amount: 14_700, referenceNo: 'PAY-1' }),
      expect.objectContaining({ sourceType: 'deposit_collection', sourceLabel: 'deposit_collection', amount: 300, referenceNo: 'DEP-1' }),
    ]));
  });

  it('returns current outstanding patient due drilldown matching dashboard total', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from bills b') && lower.includes('group by source_label') && lower.includes('coalesce(b.status')) {
          expect(lower).not.toContain('>= date(?)');
          expect(lower).not.toContain('<= date(?)');
          return { results: [{ source_label: 'partial', amount: 4000, row_count: 2 }] };
        }
        if (lower.includes('patient_due') && lower.includes('from bills b')) {
          expect(lower).not.toContain('>= date(?)');
          expect(lower).not.toContain('<= date(?)');
          return {
            results: [{
              id: 'bill-due-1',
              occurred_at: '2026-06-13 11:00:00',
              source_type: 'patient_due',
              source_label: 'partial',
              reference_no: 'INV-DUE-1',
              counter_name: 'Main Counter',
              user_name: 'Cashier A',
              amount: 4000,
              status: 'partial',
              bill_id: 5573,
              invoice_no: 'BILL-5573',
              patient_name: 'Rahim Uddin',
              patient_code: 'P-001',
              service_names: 'CBC, X-Ray',
              item_count: 2,
            }],
          };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/kpi-breakdown?metric=patient_due&date=2026-06-13');

    expect(response.status).toBe(200);
    const body = await response.json() as { metric: string; title: string; total: number; sources: Array<{ label: string; amount: number }>; rows: Array<{ referenceNo: string; amount: number; billId: number; patientName: string; serviceNames: string }> };
    expect(body).toMatchObject({ metric: 'patient_due', title: 'Patient Due', total: 4000 });
    expect(body.sources).toEqual([{ label: 'partial', amount: 4000, count: 2 }]);
    expect(body.rows[0]).toMatchObject({ referenceNo: 'INV-DUE-1', amount: 4000, billId: 5573, patientName: 'Rahim Uddin', serviceNames: 'CBC, X-Ray' });
  });



  it('returns approved expense source rows for accounting expense drilldown', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from expenses e') && lower.includes('group by source_label')) {
          return { results: [{ source_label: 'utilities', amount: 500, row_count: 1 }] };
        }
        if (lower.includes("'expense' as source_type") && lower.includes('from expenses e')) {
          return {
            results: [{
              id: 'expense-1',
              occurred_at: '2026-06-13',
              source_type: 'expense',
              source_label: 'utilities',
              reference_no: 'Electric bill',
              counter_name: null,
              user_name: 'Admin A',
              amount: 500,
              status: 'approved',
            }],
          };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/kpi-breakdown?metric=accounting_expenses&date=2026-06-13');

    expect(response.status).toBe(200);
    const body = await response.json() as { metric: string; total: number; sources: Array<{ label: string; amount: number }>; rows: Array<{ sourceLabel: string; amount: number }> };
    expect(body).toMatchObject({ metric: 'accounting_expenses', total: 500 });
    expect(body.sources).toEqual([{ label: 'utilities', amount: 500, count: 1 }]);
    expect(body.rows[0]).toMatchObject({ sourceLabel: 'utilities', amount: 500 });
  });

  it('returns source rows for patient advance drilldown', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from billing_deposits d') && lower.includes('group by source_label')) {
          return { results: [{ source_label: 'deposit', amount: 1200, row_count: 2 }] };
        }
        if (lower.includes("'patient_advance' as source_type") && lower.includes('from billing_deposits d')) {
          return {
            results: [{
              id: 'deposit-1',
              occurred_at: '2026-06-13 09:00:00',
              source_type: 'patient_advance',
              source_label: 'deposit',
              reference_no: 'DEP-1',
              counter_name: 'Front Desk',
              user_name: 'Cashier A',
              amount: 1200,
              status: 'posted',
            }],
          };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/kpi-breakdown?metric=patient_advance&date=2026-06-13');

    expect(response.status).toBe(200);
    const body = await response.json() as { metric: string; title: string; total: number; sources: Array<{ label: string; amount: number }>; rows: Array<{ referenceNo: string; amount: number }> };
    expect(body).toMatchObject({ metric: 'patient_advance', title: 'Patient Advance', total: 1200 });
    expect(body.sources).toEqual([{ label: 'deposit', amount: 1200, count: 2 }]);
    expect(body.rows[0]).toMatchObject({ referenceNo: 'DEP-1', amount: 1200 });
  });

  it('returns source rows for pending handover drilldown', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('pending_handover_sources')) {
          return { results: [{ source_label: 'counter handover', amount: 800, row_count: 1 }] };
        }
        if (lower.includes("'pending_handover' as source_type")) {
          return {
            results: [{
              id: 'handover-1',
              occurred_at: '2026-06-13 20:00:00',
              source_type: 'pending_handover',
              source_label: 'counter handover',
              reference_no: 'handover-1',
              counter_name: 'Front Desk',
              user_name: 'Cashier A',
              amount: 800,
              status: 'pending',
            }],
          };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/kpi-breakdown?metric=pending_handover&date=2026-06-13');

    expect(response.status).toBe(200);
    const body = await response.json() as { metric: string; total: number; sources: Array<{ label: string; amount: number }>; rows: Array<{ sourceLabel: string; status: string }> };
    expect(body).toMatchObject({ metric: 'pending_handover', total: 800 });
    expect(body.sources).toEqual([{ label: 'counter handover', amount: 800, count: 1 }]);
    expect(body.rows[0]).toMatchObject({ sourceLabel: 'counter handover', status: 'pending' });
  });

  it('returns source rows for discount drilldown', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from bills b') && lower.includes('sum(coalesce(b.discount')) {
          return { results: [{ source_label: 'Safaoat Ullah', amount: 350, row_count: 2 }] };
        }
        if (lower.includes("'discount' as source_type") && lower.includes('from bills b')) {
          return {
            results: [{
              id: 'discount-1',
              occurred_at: '2026-06-13 13:00:00',
              source_type: 'discount',
              source_label: 'manual discount',
              reference_no: 'BILL-5573',
              counter_name: null,
              user_name: 'Admin A',
              amount: 350,
              status: 'applied',
              bill_id: 5573,
              invoice_no: 'BILL-5573',
              patient_name: 'Rahim Uddin',
              patient_code: 'P-001',
              discount_reference: 'Safaoat Ullah',
              discount_reason: 'Doctor reference',
              service_names: 'CBC, X-Ray',
              item_count: 2,
            }],
          };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/kpi-breakdown?metric=total_discount&date=2026-06-13');

    expect(response.status).toBe(200);
    const body = await response.json() as { metric: string; total: number; sources: Array<{ label: string; amount: number }>; rows: Array<{ referenceNo: string; amount: number; billId: number; discountReference: string; patientName: string; serviceNames: string }> };
    expect(body).toMatchObject({ metric: 'total_discount', total: 350 });
    expect(body.sources).toEqual([{ label: 'Safaoat Ullah', amount: 350, count: 2 }]);
    expect(body.rows[0]).toMatchObject({ referenceNo: 'BILL-5573', amount: 350, billId: 5573, discountReference: 'Safaoat Ullah', patientName: 'Rahim Uddin', serviceNames: 'CBC, X-Ray' });
  });

  it('returns count-style source rows for pending posting drilldown', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from accounting_posting_events ape') && lower.includes('group by source_label')) {
          return { results: [{ source_label: 'failed', amount: 3, row_count: 3 }] };
        }
        if (lower.includes("'pending_posting' as source_type") && lower.includes('from accounting_posting_events ape')) {
          return {
            results: [{
              id: 'posting-1',
              occurred_at: '2026-06-13 15:00:00',
              source_type: 'pending_posting',
              source_label: 'failed',
              reference_no: 'payment_received',
              counter_name: null,
              user_name: null,
              amount: 1,
              status: 'failed',
            }],
          };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/kpi-breakdown?metric=pending_posting&date=2026-06-13');

    expect(response.status).toBe(200);
    const body = await response.json() as { metric: string; valueType: string; total: number; sources: Array<{ label: string; amount: number }>; rows: Array<{ referenceNo: string; amount: number }> };
    expect(body).toMatchObject({ metric: 'pending_posting', valueType: 'count', total: 3 });
    expect(body.sources).toEqual([{ label: 'failed', amount: 3, count: 3 }]);
    expect(body.rows[0]).toMatchObject({ referenceNo: 'payment_received', amount: 1 });
  });


  it('calculates Net Income as deposit-inclusive Total Collection minus all expense sources', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('group by source_label') && lower.includes('from payment_allocations')) {
          return { results: [{ source_label: 'OPD', amount: 14_700, row_count: 12 }] };
        }
        if (lower.includes("'payment' as source_type") && lower.includes('from payment_allocations pa')) {
          return {
            results: [{
              id: 'payment-1',
              occurred_at: '2026-06-13 10:00:00',
              source_type: 'payment',
              source_label: 'OPD',
              reference_no: 'PAY-1',
              amount: 14_700,
              status: 'posted',
            }],
          };
        }
        if (lower.includes('from billing_deposits d') && lower.includes('group by source_label')) {
          return { results: [{ source_label: 'deposit_collection', amount: 300, row_count: 1 }] };
        }
        if (lower.includes('from billing_deposits d') && lower.includes("'deposit_collection' as source_type")) {
          return {
            results: [{
              id: 'deposit-1',
              occurred_at: '2026-06-13 11:00:00',
              source_type: 'deposit_collection',
              source_label: 'deposit_collection',
              reference_no: 'DEP-1',
              amount: 300,
              status: 'posted',
            }],
          };
        }
        if (lower.includes('from expenses e') && lower.includes('group by source_label')) {
          return { results: [{ source_label: 'Operating expenses', amount: 2_190, row_count: 3 }] };
        }
        if (lower.includes("'expense' as source_type") && lower.includes('from expenses e')) {
          return {
            results: [
              {
                id: 'expense-1',
                occurred_at: '2026-06-13 12:00:00',
                source_type: 'expense',
                source_label: 'Operating expenses',
                reference_no: 'EXP-1',
                amount: 2_190,
                status: 'paid',
              },
              {
                id: 'payout-1',
                occurred_at: '2026-06-13 13:00:00',
                source_type: 'doctor_payout',
                source_label: 'Doctor payouts',
                reference_no: 'PAYOUT-1',
                amount: 5_528,
                status: 'paid',
              },
            ],
          };
        }
        if (lower.includes('from cash_drawer_movements') && lower.includes('doctor_commission_settlement') && lower.includes('group by')) {
          return { results: [{ source_label: 'Doctor payouts', amount: 5_528, row_count: 4 }] };
        }
        if (lower.includes("'doctor_payout' as source_type") && lower.includes('from cash_drawer_movements')) {
          return {
            results: [{
              id: 'payout-1',
              occurred_at: '2026-06-13 13:00:00',
              source_type: 'doctor_payout',
              source_label: 'Doctor payouts',
              reference_no: 'PAYOUT-1',
              amount: 5_528,
              status: 'paid',
            }],
          };
        }
        if (lower.includes("transaction_type = 'salesreturn'")) {
          return { results: [{ source_label: 'Sales returns / refunds', amount: 999, row_count: 1 }] };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/kpi-breakdown?metric=accounting_profit&date=2026-06-13');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      total: number;
      sources: Array<{ label: string; amount: number; direction?: string }>;
      rows: Array<{ sourceType: string; amount: number }>;
    };

    expect(body.total).toBe(7_282);
    expect(body.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'OPD', amount: 14_700, direction: 'in' }),
      expect.objectContaining({ label: 'deposit_collection', amount: 300, direction: 'in' }),
      expect.objectContaining({ label: 'Operating expenses', amount: -2_190, direction: 'out' }),
      expect.objectContaining({ label: 'Doctor payouts', amount: -5_528, direction: 'out' }),
    ]));
    expect(body.sources).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Sales returns / refunds' }),
    ]));
    expect(body.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: 'payment', amount: 14_700 }),
      expect.objectContaining({ sourceType: 'deposit_collection', amount: 300 }),
      expect.objectContaining({ sourceType: 'expense', amount: -2_190 }),
      expect.objectContaining({ sourceType: 'doctor_payout', amount: -5_528 }),
    ]));
  });

  it('returns net income minus expense rows for accounting profit drilldown', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('group by source_label') && lower.includes('from payment_allocations')) {
          return { results: [{ source_label: 'OPD', amount: 1000, row_count: 2 }] };
        }
        if (lower.includes("'payment' as source_type") && lower.includes('from payment_allocations pa')) {
          return {
            results: [{
              id: 'payment-1',
              occurred_at: '2026-06-13 10:00:00',
              source_type: 'payment',
              source_label: 'OPD',
              reference_no: 'PAY-1',
              counter_name: 'Main Counter',
              user_name: 'Cashier A',
              amount: 1000,
              status: 'posted',
            }],
          };
        }
        if (lower.includes('from expenses e') && lower.includes('group by source_label')) {
          return { results: [{ source_label: 'utilities', amount: 400, row_count: 1 }] };
        }
        if (lower.includes("'expense' as source_type") && lower.includes('from expenses e')) {
          return {
            results: [{
              id: 'expense-1',
              occurred_at: '2026-06-13',
              source_type: 'expense',
              source_label: 'utilities',
              reference_no: 'Electric bill',
              counter_name: null,
              user_name: 'Admin A',
              amount: 400,
              status: 'approved',
            }],
          };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/kpi-breakdown?metric=accounting_profit&date=2026-06-13');

    expect(response.status).toBe(200);
    const body = await response.json() as { metric: string; total: number; sources: Array<{ label: string; amount: number; direction?: string }>; rows: Array<{ sourceType: string; amount: number }> };
    expect(body).toMatchObject({ metric: 'accounting_profit', total: 600 });
    expect(body.sources).toEqual([
      { label: 'OPD', amount: 1000, count: 2, direction: 'in' },
      { label: 'utilities', amount: -400, count: 1, direction: 'out' },
    ]);
    expect(body.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: 'payment', amount: 1000 }),
      expect.objectContaining({ sourceType: 'expense', amount: -400 }),
    ]));
  });

  it('fetches through the requested offset before paginating merged Net Income rows', async () => {
    const incomeRows = Array.from({ length: 50 }, (_, index) => ({
      id: `payment-${index + 1}`,
      occurred_at: `2026-06-13 10:${String(59 - index).padStart(2, '0')}:00`,
      source_type: 'payment',
      source_label: 'OPD',
      reference_no: `PAY-${index + 1}`,
      counter_name: 'Main Counter',
      user_name: 'Cashier A',
      amount: 100,
      status: 'posted',
    }));
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('group by source_label') && lower.includes('from payment_allocations')) {
          return { results: [{ source_label: 'OPD', amount: 5000, row_count: 50 }] };
        }
        if (lower.includes("'payment' as source_type") && lower.includes('from payment_allocations pa')) {
          return { results: incomeRows };
        }
        if (lower.includes('from expenses e') || lower.includes('doctor_commission_settlement')) {
          return { results: [] };
        }
        if (lower.includes("transaction_type = 'salesreturn'")) {
          return { results: [] };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/kpi-breakdown?metric=accounting_profit&date=2026-06-13&page=2&pageSize=25');
    expect(response.status).toBe(200);
    const body = await response.json() as { page: number; pageSize: number; rows: Array<{ referenceNo: string }> };
    expect(body).toMatchObject({ page: 2, pageSize: 25 });
    expect(body.rows).toHaveLength(25);

    const incomeDetailQuery = mockDB.queries.find((query) => query.sql.toLowerCase().includes('from payment_allocations pa'));
    expect(incomeDetailQuery?.params.slice(-2)).toEqual([50, 0]);
  });

  it('accepts MD dashboard GL expense drilldown metric names', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from accounting_journal_lines') && lower.includes('a.type = ?')) {
          expect(params).toContain('expense');
          return {
            results: [
              { name: 'Utilities', code: 'EXP-UTIL', amount: 900, count: 2 },
            ],
          };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/kpi-breakdown?metric=gl_expenses&date=2026-06-13');

    expect(response.status).toBe(200);
    const body = await response.json() as { metric: string; title: string; total: number; sources: Array<{ label: string; amount: number; direction?: string }> };
    expect(body).toMatchObject({ metric: 'gl_expenses', title: 'Accounted Expenses', total: 900 });
    expect(body.sources).toEqual([{ label: 'Utilities', amount: 900, count: 2, direction: 'out' }]);
  });

  it('uses the shared custom date range for KPI drilldowns', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
    });

    const response = await app.request(
      '/dashboard/kpi-breakdown?metric=inventory_low_stock&preset=custom&startDate=2026-07-01&endDate=2026-07-31',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { period: { startDate: string; endDate: string; label: string } };
    expect(body.period).toEqual({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      label: '2026-07-01 → 2026-07-31',
    });
  });

  it('rejects unsupported KPI metric names', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
    });

    const response = await app.request('/dashboard/kpi-breakdown?metric=unknown_metric');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Unsupported KPI metric' });
  });
});
