import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

type TestPerformanceResponse = {
  period: { startDate: string; endDate: string; label: string };
  totals: {
    quantity: number;
    billed: number;
    collected: number;
    due: number;
    testCommission: number;
  };
  rows: Array<{
    testId: number;
    testCode: string | null;
    testName: string;
    quantity: number;
    billed: number;
    collected: number;
    due: number;
    testCommission: number;
  }>;
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
};

describe('executive test performance analytics', () => {
  it('returns billing-backed test quantity and financials without requiring lab order items', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        if (lower.includes('executive_test:summary')) {
          expect(lower).toContain('billing_lines as');
          expect(lower).toContain('payment_allocations as');
          expect(lower).toContain('commission_facts as');
          expect(lower).toContain("ii.item_category = 'test'");
          expect(lower).toContain('billing_service_items');
          expect(lower).not.toContain('ordered_facts as');
          expect(lower).not.toContain('completed_facts as');
          expect(lower).not.toContain('ii.reference_id = loi.id');
          expect(lower).toContain('order by quantity desc');
          expect(params.at(-2)).toBe(25);
          expect(params.at(-1)).toBe(0);
          return {
            results: [
              {
                test_id: 396,
                test_code: 'CBC_PLT',
                test_name: 'CBC & Platelet Count',
                quantity: 76,
                billed: 27584,
                collected: 26061,
                due: 1523,
                test_commission: 1200,
                total_rows: 2,
                overall_quantity: 136,
                overall_billed: 38244,
                overall_collected: 36170,
                overall_due: 2074,
                overall_test_commission: 1600,
              },
              {
                test_id: 242,
                test_code: 'B-01',
                test_name: 'BloodSugar (RBS,PPBS)',
                quantity: 60,
                billed: 10660,
                collected: 10109,
                due: 551,
                test_commission: 400,
                total_rows: 2,
                overall_quantity: 136,
                overall_billed: 38244,
                overall_collected: 36170,
                overall_due: 2074,
                overall_test_commission: 1600,
              },
            ],
          };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/test-performance?date=2026-07-10&sortBy=quantity&sortDirection=desc&pageSize=25');
    expect(response.status).toBe(200);
    const body = await response.json() as TestPerformanceResponse;
    expect(body.rows[0]).toEqual({
      testId: 396,
      testCode: 'CBC_PLT',
      testName: 'CBC & Platelet Count',
      quantity: 76,
      billed: 27584,
      collected: 26061,
      due: 1523,
      testCommission: 1200,
    });
    expect(body.totals).toEqual({
      quantity: 136,
      billed: 38244,
      collected: 36170,
      due: 2074,
      testCommission: 1600,
    });
    expect(body).toMatchObject({ page: 1, pageSize: 25, totalRows: 2, hasNextPage: false });
    expect(mockDB.queries.filter((query) => query.sql.includes('executive_test:summary'))).toHaveLength(1);
  });

  it('searches service code, service name, and invoice description and rejects legacy status filters', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        if (lower.includes('executive_test:summary')) {
          expect(lower).toContain('test_code');
          expect(lower).toContain('test_name');
          expect(lower).toContain('invoice_description');
          expect(params.some((value) => value === '%CBC%')).toBe(true);
          return {
            results: [{
              test_id: 396,
              test_code: 'CBC_PLT',
              test_name: 'CBC & Platelet Count',
              quantity: 4,
              billed: 1300,
              collected: 800,
              due: 500,
              test_commission: 120,
              total_rows: 1,
              overall_quantity: 4,
              overall_billed: 1300,
              overall_collected: 800,
              overall_due: 500,
              overall_test_commission: 120,
            }],
          };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/test-performance?search=CBC&sortBy=billed&pageSize=50');
    expect(response.status).toBe(200);
    const body = await response.json() as TestPerformanceResponse;
    expect(body.rows.map((row) => row.testName)).toContain('CBC & Platelet Count');

    expect((await app.request('/dashboard/test-performance?status=completed')).status).toBe(400);
  });

  it('rejects unsupported sort and page-size values before querying', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    expect((await app.request('/dashboard/test-performance?sortBy=completed')).status).toBe(400);
    expect((await app.request('/dashboard/test-performance?sortBy=raw_formula')).status).toBe(400);
    expect((await app.request('/dashboard/test-performance?pageSize=75')).status).toBe(400);
    expect((await app.request('/dashboard/test-performance/1/details?view=raw_formula')).status).toBe(400);
    expect(mockDB.queries).toHaveLength(0);
  });

  it('returns one billing line per detail row without requiring lab workflow data', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'director',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        if (lower.includes('executive_test:details')) {
          expect(lower).toContain('from invoice_items ii');
          expect(lower).toContain('join bills b');
          expect(lower).toContain("ii.item_category = 'test'");
          expect(lower).toContain('payment_allocations');
          expect(lower).not.toContain('from lab_order_items loi');
          expect(params).toContain(396);
          return {
            results: [{
              id: 501,
              occurred_at: '2026-07-10 11:00:00',
              test_name: 'CBC & Platelet Count',
              patient_name: 'Patient A',
              quantity: 1,
              referring_doctor_id: 7,
              referring_doctor_name: 'Dr A',
              ordering_clinician_id: 8,
              ordering_clinician_name: 'Dr Orderer',
              entered_by_user_id: 77,
              entered_by_name: 'Reception User',
              performing_doctor_id: 9,
              performing_doctor_name: 'Dr Performer',
              invoice_no: 'INV-2',
              status: 'completed',
              gross_amount: 600,
              discount_amount: 100,
              billed_amount: 500,
              collected_amount: 200,
              due_amount: 300,
              performer_reserve_amount: 125,
              test_commission: 50,
              total_rows: 1,
              overall_quantity: 1,
              overall_billed: 500,
              overall_collected: 200,
              overall_due: 300,
              overall_test_commission: 50,
              overall_performer_reserve: 125,
              referring_doctor_count: 1,
              performing_doctor_count: 1,
            }],
          };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/test-performance/396/details?date=2026-07-10&pageSize=25');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      testId: number;
      view: string;
      summary: Record<string, number>;
      rows: Array<Record<string, unknown>>;
      totalRows: number;
    };
    expect(body).toMatchObject({
      testId: 396,
      view: 'lines',
      totalRows: 1,
      summary: {
        quantity: 1,
        billed: 500,
        collected: 200,
        due: 300,
        testCommission: 50,
        performerReserve: 125,
        referringDoctorCount: 1,
        performingDoctorCount: 1,
      },
    });
    expect(body.rows[0]).toEqual({
      id: 501,
      occurredAt: '2026-07-10 11:00:00',
      testName: 'CBC & Platelet Count',
      patientName: 'Patient A',
      quantity: 1,
      referringDoctorId: 7,
      referringDoctorName: 'Dr A',
      orderingClinicianId: 8,
      orderingClinicianName: 'Dr Orderer',
      enteredByUserId: 77,
      enteredByName: 'Reception User',
      performingDoctorId: 9,
      performingDoctorName: 'Dr Performer',
      invoiceNo: 'INV-2',
      status: 'completed',
      grossAmount: 600,
      discountAmount: 100,
      billedAmount: 500,
      collectedAmount: 200,
      dueAmount: 300,
      performerReserveAmount: 125,
      testCommission: 50,
    });
  });

  it('keeps unassigned test commission out of billing service rows', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('executive_test:summary')) {
          expect(lower).toContain('resolved_service_item_id');
          expect(lower).toContain('resolved_service_item_id is not null');
          return { results: [] };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/test-performance?date=2026-07-10&pageSize=25');
    expect(response.status).toBe(200);
    const body = await response.json() as TestPerformanceResponse;
    expect(body.rows).toEqual([]);
    expect(body.totals.testCommission).toBe(0);
  });
});
