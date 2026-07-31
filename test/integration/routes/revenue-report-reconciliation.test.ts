import { describe, expect, it } from 'vitest';
import reportsRoute from '../../../src/routes/tenant/reports';
import { createTestApp } from '../helpers/test-app';

const TENANT_ID = 'tenant-1';

describe('Revenue report reconciliation surfaces', () => {
  it('returns service department revenue net/gross totals with GL reconciliation', async () => {
    const { app, mockDB } = createTestApp({
      route: reportsRoute,
      routePath: '/reports',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql) => {
        if (sql.includes('FROM accounting_journal_lines jl') && sql.includes("a.type IN ('revenue', 'expense')")) {
          return { first: { income: 1650, expense: 0 } };
        }
        if (sql.includes('FROM invoice_items ii') && sql.includes('billing_service_departments') && sql.includes('GROUP BY department')) {
          return {
            results: [
              {
                department: 'Laboratory',
                bill_count: 2,
                revenue: 1450,
                discount_amount: 150,
                gross_revenue: 1600,
                patient_count: 2,
              },
              {
                department: 'Radiology',
                bill_count: 1,
                revenue: 50,
                discount_amount: 0,
                gross_revenue: 50,
                patient_count: 1,
              },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request('/reports/department-revenue?startDate=2026-05-01&endDate=2026-05-10');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      totalRevenue: number;
      summary: {
        totalRevenue: number;
        totalDiscount: number;
        totalGrossRevenue: number;
        glRevenue: number;
        glDifference: number;
      };
      byDepartment: Array<{ department: string; revenue: number; grossRevenue: number; discountAmount: number }>;
    };
    expect(body.totalRevenue).toBe(1500);
    expect(body.summary).toEqual({
      totalRevenue: 1500,
      totalDiscount: 150,
      totalGrossRevenue: 1650,
      glRevenue: 1650,
      glDifference: 0,
    });
    expect(body.byDepartment[0]).toMatchObject({
      department: 'Laboratory',
      revenue: 1450,
      grossRevenue: 1600,
      discountAmount: 150,
    });
    const sql = mockDB.queries.find((q) => q.sql.includes('GROUP BY department'))?.sql ?? '';
    expect(sql).toContain('FROM invoice_items ii');
    expect(sql).toContain('billing_service_departments');
    expect(sql).not.toContain('COALESCE(v.visit_type');
  });

  it('rejects inverted department revenue date ranges before running report SQL', async () => {
    const { app, mockDB } = createTestApp({
      route: reportsRoute,
      routePath: '/reports',
      role: 'accountant',
      tenantId: TENANT_ID,
    });

    const res = await app.request('/reports/department-revenue?startDate=2026-06-01&endDate=2026-05-01');
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/startDate must be on or before endDate/i);
    expect(mockDB.queries.some((q) => q.sql.includes('FROM invoice_items ii'))).toBe(false);
  });

  it('uses real commission_amount/source_type values in doctor performance', async () => {
    const { app } = createTestApp({
      route: reportsRoute,
      routePath: '/reports',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql) => {
        if (sql.includes('WITH performance_stats AS') && sql.includes('dca.commission_amount')) {
          return {
            results: [
              {
                id: 7,
                name: 'Dr. Aminul Islam',
                specialty: 'General Medicine',
                visit_count: 4,
                unique_patients: 3,
                total_revenue: 2000,
                consultation_fees: 300,
                lab_test_commissions: 125,
                referral_commissions: 75,
                total_commissions: 500,
              },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request('/reports/doctor-performance?startDate=2026-05-01&endDate=2026-05-10');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      doctors: Array<{
        revenue: number;
        consultationFees: number;
        labTestCommissions: number;
        referralCommissions: number;
        totalCommissions: number;
        netHospitalIncome: number;
      }>;
      summary: {
        totalDoctors: number;
        totalVisits: number;
        totalRevenue: number;
        totalCommissions: number;
        totalNetHospitalIncome: number;
      };
    };
    expect(body.doctors[0]).toMatchObject({
      revenue: 2000,
      consultationFees: 300,
      labTestCommissions: 125,
      referralCommissions: 75,
      totalCommissions: 500,
      netHospitalIncome: 1500,
    });
    expect(body.summary).toMatchObject({
      totalDoctors: 1,
      totalVisits: 4,
      totalRevenue: 2000,
      totalCommissions: 500,
      totalReferralLabRevenue: 0,
      totalNetHospitalIncome: 1500,
    });
  });

  it('adds commission-linked consultation revenue that is missing a visit link without double-counting linked bills', async () => {
    const { app, mockDB } = createTestApp({
      route: reportsRoute,
      routePath: '/reports',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql) => {
        if (sql.includes('WITH performance_stats AS') && sql.includes('dca.commission_amount')) {
          return {
            results: [
              {
                id: 11,
                name: 'Dr. Example Three',
                specialty: 'Medicine and Kidney',
                visit_count: 7,
                unique_patients: 7,
                total_revenue: 1700,
                unlinked_consultation_revenue: 3500,
                consultation_fees: 4200,
                lab_test_commissions: 0,
                referral_commissions: 0,
                total_commissions: 4200,
                referral_lab_revenue: 0,
              },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request('/reports/doctor-performance?startDate=2026-05-01&endDate=2026-05-10');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      doctors: Array<{
        netHospitalIncome: number;
        totalCommissions: number;
        revenue: number;
        unlinkedConsultationRevenue: number;
        referralLabRevenue: number;
      }>;
      summary: { totalNetHospitalIncome: number; totalCommissions: number; totalRevenue: number; totalReferralLabRevenue: number };
    };
    expect(body.doctors[0]).toMatchObject({
      revenue: 5200,
      unlinkedConsultationRevenue: 3500,
      totalCommissions: 4200,
      referralLabRevenue: 0,
      netHospitalIncome: 1000,
    });
    expect(body.summary).toMatchObject({
      totalRevenue: 5200,
      totalCommissions: 4200,
      totalReferralLabRevenue: 0,
      totalNetHospitalIncome: 1000,
    });
    const query = mockDB.queries.find((q) => q.sql.includes('WITH performance_stats AS'));
    const sql = query?.sql ?? '';
    expect(sql).toContain('consultation_bill_links');
    expect(sql).toContain('unlinked_consultation_revenue');
    expect(sql).toContain('v.id IS NULL OR v.doctor_id != cbl.doctor_id');
    expect(sql).toContain('WHERE ii.tenant_id = ?');
    expect(sql).toContain('ORDER BY (');
    expect(sql).toContain('COALESCE(cr.unlinked_consultation_revenue, 0)');
    expect(sql).toContain('COALESCE(t.test_revenue, 0)');
    expect(sql).toContain('COALESCE(r.referral_lab_revenue, 0)');
    expect(sql).toContain('- COALESCE(c.total_commissions, 0)');
    expect(query?.params).toEqual([
      TENANT_ID, '2026-05-01', '2026-05-10',
      TENANT_ID, '2026-05-01', '2026-05-10',
      TENANT_ID, '2026-05-01', '2026-05-10',
      TENANT_ID,
      TENANT_ID, '2026-05-01', '2026-05-10',
      TENANT_ID, '2026-05-01', '2026-05-10',
      TENANT_ID,
    ]);
  });

  it('offsets referral commissions with the linked referral-lab bill revenue so the net reflects hospital earnings', async () => {
    const { app } = createTestApp({
      route: reportsRoute,
      routePath: '/reports',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql) => {
        if (sql.includes('WITH performance_stats AS') && sql.includes('dca.commission_amount')) {
          return {
            results: [
              {
                id: 12,
                name: 'Dr. Habibur Rahman',
                specialty: 'Cardiology',
                visit_count: 4,
                unique_patients: 4,
                total_revenue: 1200,
                consultation_fees: 400,
                lab_test_commissions: 0,
                referral_commissions: 600,
                total_commissions: 1000,
                referral_lab_revenue: 5000,
              },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request('/reports/doctor-performance?startDate=2026-05-01&endDate=2026-05-10');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      doctors: Array<{
        netHospitalIncome: number;
        revenue: number;
        totalCommissions: number;
        referralLabRevenue: number;
      }>;
    };
    expect(body.doctors[0]).toMatchObject({
      revenue: 1200,
      totalCommissions: 1000,
      referralLabRevenue: 5000,
      netHospitalIncome: 5200,
    });
  });

  it('keeps inactive doctors in doctor performance when they have historical revenue or commission', async () => {
    const { app, mockDB } = createTestApp({
      route: reportsRoute,
      routePath: '/reports',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql) => {
        if (sql.includes('WITH performance_stats AS') && sql.includes('dca.commission_amount')) {
          return {
            results: [
              {
                id: 9,
                name: 'Dr. Historical',
                specialty: 'Surgery',
                visit_count: 1,
                unique_patients: 1,
                total_revenue: 1000,
                consultation_fees: 250,
                lab_test_commissions: 0,
                referral_commissions: 0,
                total_commissions: 250,
              },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request('/reports/doctor-performance?startDate=2026-05-01&endDate=2026-05-31');

    expect(res.status).toBe(200);
    const body = await res.json() as { doctors: Array<{ id: number; revenue: number; totalCommissions: number }> };
    expect(body.doctors).toContainEqual(expect.objectContaining({ id: 9, revenue: 1000, totalCommissions: 250 }));
    const sql = mockDB.queries.find((q) => q.sql.includes('WITH performance_stats AS'))?.sql ?? '';
    expect(sql).toContain('COALESCE(p.visit_count, 0) > 0');
    expect(sql).toContain('COALESCE(c.total_commissions, 0)');
  });

  it('rejects inverted doctor performance date ranges before running report SQL', async () => {
    const { app, mockDB } = createTestApp({
      route: reportsRoute,
      routePath: '/reports',
      role: 'accountant',
      tenantId: TENANT_ID,
    });

    const res = await app.request('/reports/doctor-performance?startDate=2026-06-01&endDate=2026-05-01');
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/startDate must be on or before endDate/i);
    expect(mockDB.queries.some((q) => q.sql.includes('WITH performance_stats AS'))).toBe(false);
  });
});
