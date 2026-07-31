import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

describe('admin dashboard — today summary, patient summary, financial, lab, pharmacy, bed', () => {
  it('returns today summary with all new fields', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        // Today's new patients (existing query)
        if (lower.includes('from patients') && lower.includes('date(created_at)')) {
          return { results: [{ count: 47 }] };
        }
        // Today's appointments
        if (lower.includes('from appointments') && lower.includes('appt_date')) {
          return { results: [{ count: 62 }] };
        }
        // Today's completed consultations
        if (lower.includes('from visits') && lower.includes("status in ('completed', 'closed')")) {
          return { results: [{ count: 38 }] };
        }
        // Today's pharmacy sales
        if (lower.includes('from pharmacy_sales') && lower.includes('net_amount')) {
          return { results: [{ total: 18500, count: 23 }] };
        }
        // Today's admitted patients
        if (lower.includes('from admissions') && lower.includes("status in ('admitted', 'critical')")) {
          return { results: [{ count: 5 }] };
        }
        // Today's discharged patients
        if (lower.includes('from admissions') && lower.includes("status = 'discharged'")) {
          return { results: [{ count: 3 }] };
        }
        // Weekly income
        if (lower.includes('from accounting_posting_events') && lower.includes("event_type = 'payment_received'") && lower.includes('from payments') && !lower.includes('group by') && !lower.includes("payment_type = 'due'") && !lower.includes("$.paymenttype")) {
          return { results: [{ total: 285000 }] };
        }
        // Cashier-wise collection
        if (lower.includes('ledger_by_cashier') && lower.includes('payment_by_cashier')) {
          return { results: [
            { cashier_name: 'Karim', total_collected: 18000 },
            { cashier_name: 'Rahim', total_collected: 12000 },
          ]};
        }
        // Due collection today
        if (lower.includes('from payments') && lower.includes("payment_type = 'due'")) {
          return { results: [{ total: 8500 }] };
        }
        // Returning patients
        if (lower.includes('count(distinct v.patient_id)') && lower.includes('having count(*) > 1')) {
          return { results: [{ count: 15 }] };
        }
        // OPD/IPD/Emergency split
        if (lower.includes('sum(case when visit_type')) {
          return { results: [{ opd: 42, ipd: 8, emergency: 4 }] };
        }
        // Daily lab income
        if (lower.includes("source = 'laboratory'")) {
          return { results: [{ total: 8500 }] };
        }
        // Bed status summary
        if (lower.includes('from beds') && lower.includes("status = 'cleaning'")) {
          return { results: [{ total: 50, available: 20, occupied: 22, cleaning: 4, maintenance: 2, reserved: 2 }] };
        }
        return null;
      },
    });

    const res = await app.request('/dashboard/stats');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    // ── Today Summary ──
    const todaySummary = body.todaySummary as Record<string, number>;
    expect(todaySummary.newPatients).toBe(47); // from existing todayPatients query
    expect(todaySummary.totalAppointments).toBe(62);
    expect(todaySummary.completedConsultations).toBe(38);
    expect(todaySummary.pharmacySales).toBe(18500);
    expect(todaySummary.pharmacySalesCount).toBe(23);
    expect(todaySummary.admittedPatients).toBe(5);
    expect(todaySummary.dischargedPatients).toBe(3);
  });

  it('returns patient summary with OPD/IPD/Emergency split', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('sum(case when visit_type')) {
          return { results: [{ opd: 42, ipd: 8, emergency: 4 }] };
        }
        if (lower.includes('count(distinct v.patient_id)') && lower.includes('having count(*) > 1')) {
          return { results: [{ count: 15 }] };
        }
        return null;
      },
    });

    const res = await app.request('/dashboard/stats');
    const body = await res.json() as Record<string, unknown>;
    const patientSummary = body.patientSummary as Record<string, number>;

    expect(patientSummary.returningPatients).toBe(15);
    expect(patientSummary.opdPatients).toBe(42);
    expect(patientSummary.ipdPatients).toBe(8);
    expect(patientSummary.emergencyPatients).toBe(4);
  });

  it('returns financial summary with weekly income and cashier collection', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from accounting_posting_events') && lower.includes("event_type = 'payment_received'") && lower.includes('from payments') && !lower.includes('group by') && !lower.includes("payment_type = 'due'") && !lower.includes("$.paymenttype")) {
          return { results: [{ total: 285000 }] };
        }
        if (lower.includes('ledger_by_cashier') && lower.includes('payment_by_cashier')) {
          return { results: [
            { cashier_name: 'Karim', total_collected: 18000 },
            { cashier_name: 'Rahim', total_collected: 12000 },
          ]};
        }
        if (lower.includes('from payments') && lower.includes("payment_type = 'due'")) {
          return { results: [{ total: 8500 }] };
        }
        return null;
      },
    });

    const res = await app.request('/dashboard/stats');
    const body = await res.json() as Record<string, unknown>;
    const financialSummary = body.financialSummary as Record<string, unknown>;

    expect(financialSummary.weeklyIncome).toBe(285000);
    expect(financialSummary.dueCollection).toBe(8500);
    expect(financialSummary.cashierCollection).toEqual([
      { cashierName: 'Karim', amount: 18000 },
      { cashierName: 'Rahim', amount: 12000 },
    ]);
  });

  it('returns lab summary with daily income', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes("source = 'laboratory'")) {
          return { results: [{ total: 8500 }] };
        }
        return null;
      },
    });

    const res = await app.request('/dashboard/stats');
    const body = await res.json() as Record<string, unknown>;
    const labSummary = body.labSummary as Record<string, number>;

    expect(labSummary.dailyIncome).toBe(8500);
  });

  it('returns pharmacy summary with today sales', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from pharmacy_sales') && lower.includes('net_amount')) {
          return { results: [{ total: 18500, count: 23 }] };
        }
        return null;
      },
    });

    const res = await app.request('/dashboard/stats');
    const body = await res.json() as Record<string, unknown>;
    const pharmacySummary = body.pharmacySummary as Record<string, number>;

    expect(pharmacySummary.todaySales).toBe(18500);
    expect(pharmacySummary.todaySalesCount).toBe(23);
  });

  it('returns bed summary with all status counts and occupancy percentage', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from beds') && lower.includes("status = 'cleaning'")) {
          return { results: [{ total: 50, available: 20, occupied: 22, cleaning: 4, maintenance: 2, reserved: 2 }] };
        }
        return null;
      },
    });

    const res = await app.request('/dashboard/stats');
    const body = await res.json() as Record<string, unknown>;
    const bedSummary = body.bedSummary as Record<string, number>;

    expect(bedSummary.total).toBe(50);
    expect(bedSummary.available).toBe(20);
    expect(bedSummary.occupied).toBe(22);
    expect(bedSummary.cleaning).toBe(4);
    expect(bedSummary.maintenance).toBe(2);
    expect(bedSummary.reserved).toBe(2);
    expect(bedSummary.occupancyPercentage).toBe(44.0);
  });

  it('handles zero beds gracefully', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from beds') && lower.includes("status = 'cleaning'")) {
          return { results: [{ total: 0, available: 0, occupied: 0, cleaning: 0, maintenance: 0, reserved: 0 }] };
        }
        return null;
      },
    });

    const res = await app.request('/dashboard/stats');
    const body = await res.json() as Record<string, unknown>;
    const bedSummary = body.bedSummary as Record<string, number>;

    expect(bedSummary.total).toBe(0);
    expect(bedSummary.occupancyPercentage).toBe(0);
  });

  it('executes the correct SQL queries for new dashboard sections', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    await app.request('/dashboard/stats');

    const sqls = mockDB.queries.map((q) => q.sql.toLowerCase());

    // Verify new queries are executed
    expect(sqls.some((s) => s.includes('from appointments') && s.includes('appt_date'))).toBe(true);
    expect(sqls.some((s) => s.includes('from visits') && s.includes("status in ('completed', 'closed')"))).toBe(true);
    expect(sqls.some((s) => s.includes('from pharmacy_sales') && s.includes('net_amount'))).toBe(true);
    expect(sqls.some((s) => s.includes('from admissions') && s.includes("status in ('admitted', 'critical')"))).toBe(true);
    expect(sqls.some((s) => s.includes('from admissions') && s.includes("status = 'discharged'"))).toBe(true);
    expect(sqls.some((s) => s.includes('ledger_by_cashier') && s.includes('payment_by_cashier'))).toBe(true);
    expect(sqls.some((s) => s.includes('from payments') && s.includes("payment_type = 'due'"))).toBe(true);
    expect(sqls.some((s) => s.includes("source = 'laboratory'"))).toBe(true);
    expect(sqls.some((s) => s.includes('from beds') && s.includes("status = 'cleaning'"))).toBe(true);
    expect(sqls.some((s) => s.includes('count(distinct v.patient_id)'))).toBe(true);
    expect(sqls.some((s) => s.includes('sum(case when visit_type'))).toBe(true);
  });

  it('returns default zeros when DB returns empty results', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: () => ({ results: [] }),
    });

    const res = await app.request('/dashboard/stats');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    const todaySummary = body.todaySummary as Record<string, number>;
    expect(todaySummary.totalAppointments).toBe(0);
    expect(todaySummary.completedConsultations).toBe(0);
    expect(todaySummary.pharmacySales).toBe(0);
    expect(todaySummary.admittedPatients).toBe(0);
    expect(todaySummary.dischargedPatients).toBe(0);

    const bedSummary = body.bedSummary as Record<string, number>;
    expect(bedSummary.total).toBe(0);
    expect(bedSummary.occupancyPercentage).toBe(0);
  });
});
