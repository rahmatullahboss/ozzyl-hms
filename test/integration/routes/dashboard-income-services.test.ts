import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

type IncomeServiceResponse = {
  period: { startDate: string; endDate: string; label: string };
  totals: { transactions: number; units: number; collection: number };
  rows: Array<{
    serviceName: string;
    category: string;
    transactions: number;
    units: number;
    collection: number;
    share: number;
  }>;
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
};

describe('executive exact service income analysis', () => {
  it('allocates a partial payment to exact active invoice service names', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        if (lower.includes('executive_income:services')) {
          expect(lower).toContain('payment_allocations as');
          expect(lower).toContain('active_items as');
          expect(lower).toContain('allocation_base');
          expect(lower).toContain('pb.payment_amount * ai.line_amount / bit.allocation_base');
          expect(lower).toContain('service_name');
          expect(lower).toContain("coalesce(ii.status, 'active') != 'cancelled'");
          expect(lower).toContain('where coalesce(bit.allocation_base, 0) <= 0');
          expect(lower).toContain('order by collection desc');
          expect(params.at(-2)).toBe(25);
          expect(params.at(-1)).toBe(0);
          return {
            results: [
              { service_name: 'Doctor Consultation', category: 'OPD', transactions: 1, units: 1, collection: 300, total_rows: 5, overall_transactions: 1, overall_units: 5, overall_collection: 1000 },
              { service_name: 'Admission Fee', category: 'IPD', transactions: 1, units: 1, collection: 100, total_rows: 5, overall_transactions: 1, overall_units: 5, overall_collection: 1000 },
              { service_name: 'Bed Charge', category: 'IPD', transactions: 1, units: 1, collection: 200, total_rows: 5, overall_transactions: 1, overall_units: 5, overall_collection: 1000 },
              { service_name: 'CBC', category: 'Lab', transactions: 1, units: 1, collection: 250, total_rows: 5, overall_transactions: 1, overall_units: 5, overall_collection: 1000 },
              { service_name: 'X-Ray Chest', category: 'Radiology', transactions: 1, units: 1, collection: 150, total_rows: 5, overall_transactions: 1, overall_units: 5, overall_collection: 1000 },
            ],
          };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/income-services?date=2026-07-10&sortBy=collection&sortDirection=desc&pageSize=25');
    expect(response.status).toBe(200);
    const body = await response.json() as IncomeServiceResponse;
    expect(body.rows.map((row) => row.serviceName)).toEqual([
      'Doctor Consultation', 'Admission Fee', 'Bed Charge', 'CBC', 'X-Ray Chest',
    ]);
    expect(body.rows.map((row) => row.serviceName)).not.toContain('OPD');
    expect(body.rows.map((row) => row.serviceName)).not.toContain('IPD');
    expect(body.rows.reduce((sum, row) => sum + row.collection, 0)).toBe(1000);
    expect(body.totals).toEqual({ transactions: 1, units: 5, collection: 1000 });
    expect(body.rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(100, 2);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('billing_deposits'))).toBe(false);
  });

  it('supports safe lab/non-lab filtering and exact-name search', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        if (lower.includes('executive_income:services')) {
          expect(lower).toContain("category = 'lab'");
          expect(lower).toContain('lower(service_name) like lower(?)');
          expect(params).toContain('%CBC%');
          return { results: [{ service_name: 'CBC', category: 'Lab', transactions: 2, units: 2, collection: 800, total_rows: 1, overall_transactions: 2, overall_units: 2, overall_collection: 800 }] };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/income-services?category=lab&search=CBC&sortBy=serviceName&sortDirection=asc&pageSize=50');
    expect(response.status).toBe(200);
    const body = await response.json() as IncomeServiceResponse;
    expect(body.rows[0]).toMatchObject({ serviceName: 'CBC', category: 'Lab', collection: 800, share: 100 });
  });

  it('rejects arbitrary category, sort, or page size before SQL', async () => {
    const { app, mockDB } = createTestApp({ route: dashboardRoutes, routePath: '/dashboard', role: 'hospital_admin', tenantId: 'tenant-1' });
    expect((await app.request('/dashboard/income-services?category=custom_sql')).status).toBe(400);
    expect((await app.request('/dashboard/income-services?sortBy=formula')).status).toBe(400);
    expect((await app.request('/dashboard/income-services?pageSize=75')).status).toBe(400);
    expect(mockDB.queries).toHaveLength(0);
  });
});
