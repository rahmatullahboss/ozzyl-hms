import { describe, expect, it } from 'vitest';
import reportLab from '../src/routes/tenant/reportLab';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp } from './integration/helpers/test-app';

function makeReportApp() {
  const mockDB = createMockDB({
    queryOverride(sql) {
      const s = sql.toLowerCase();

      if (s.includes('group by category')) {
        return {
          results: [{
            category: 'hematology',
            test_count: 3,
            revenue: 15_000,
            completed: 2,
            pending: 1,
          }],
        };
      }

      if (s.includes('group by ltc.id') && s.includes('order_count')) {
        return {
          results: [{
            test_name: 'CBC',
            test_code: 'CBC',
            category: 'hematology',
            order_count: 4,
            revenue: 20_000,
          }],
        };
      }

      if (s.includes('consultation_fee_revenue') && s.includes('doctor_id')) {
        return {
          results: [{
            doctor_id: 7,
            doctor_name: 'Dr Rahman',
            specialty: 'Medicine',
            visit_count: 5,
            lab_test_count: 8,
            lab_revenue: 40_000,
            consumable_cost: 6_000,
            test_commission: 4_000,
            consultation_fee_revenue: 10_000,
          }],
        };
      }

      if (s.includes('consumable_cost') && s.includes('doctor_commission')) {
        return {
          results: [{
            lab_test_id: 33,
            test_name: 'CBC',
            test_code: 'CBC',
            category: 'hematology',
            total_tests: 2,
            revenue: 10_000,
            consumable_cost: 1_200,
            doctor_commission: 1_000,
          }],
        };
      }

      return null;
    },
  });

  return createTestApp({
    route: reportLab,
    routePath: '/reports/lab',
    role: 'hospital_admin',
    tenantId: '1',
    mockDB,
  });
}

describe('lab finance reporting routes', () => {
  it('returns frontend-compatible category report data', async () => {
    const { app } = makeReportApp();
    const res = await app.request('/reports/lab/by-category');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: [{
        category_name: 'hematology',
        total_orders: 3,
        completed_orders: 2,
        pending_orders: 1,
        total_revenue: 15_000,
      }],
      totalTests: 3,
      totalRevenue: 15_000,
    });
  });

  it('returns frontend-compatible top test report data', async () => {
    const { app } = makeReportApp();
    const res = await app.request('/reports/lab/top-tests?limit=5');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: [{
        test_name: 'CBC',
        total_orders: 4,
        total_revenue: 20_000,
      }],
    });
  });

  it('returns lab test profitability including consumables and doctor commission', async () => {
    const { app } = makeReportApp();
    const res = await app.request('/reports/lab/profitability');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: [{
        labTestId: 33,
        testName: 'CBC',
        totalTests: 2,
        revenue: 10_000,
        consumableCost: 1_200,
        doctorCommission: 1_000,
        grossProfit: 7_800,
        marginPercent: 78,
      }],
      totals: {
        revenue: 10_000,
        consumableCost: 1_200,
        doctorCommission: 1_000,
        grossProfit: 7_800,
      },
    });
  });

  it('returns doctor-wise lab and consultation finance summary', async () => {
    const { app } = makeReportApp();
    const res = await app.request('/reports/lab/doctor-summary');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: [{
        doctorId: 7,
        doctorName: 'Dr Rahman',
        visitCount: 5,
        labTestCount: 8,
        consultationFeeRevenue: 10_000,
        labRevenue: 40_000,
        consumableCost: 6_000,
        testCommission: 4_000,
        grossProfit: 30_000,
      }],
    });
  });

  it('uses doctors.specialty and excludes cancelled lab items from finance SQL', async () => {
    const { app, mockDB } = makeReportApp();

    await app.request('/reports/lab/by-category');
    await app.request('/reports/lab/top-tests?limit=5');
    await app.request('/reports/lab/trend?days=7');
    await app.request('/reports/lab/profitability');
    await app.request('/reports/lab/doctor-summary');

    const sql = mockDB.queries
      .map((query) => query.sql.replace(/\s+/g, ' ').toLowerCase())
      .join('\n');

    expect(sql).toContain('select id, name, specialty');
    expect(sql).not.toContain('select id, name, specialization');
    expect(sql).toContain("coalesce(loi.status, 'pending') != 'cancelled'");
  });
});
