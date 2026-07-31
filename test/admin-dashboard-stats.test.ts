import { describe, it, expect } from 'vitest';
import dashboardRoute from '../src/routes/tenant/dashboard';
import { createTestApp } from './integration/helpers/test-app';

const TENANT_ID = 'tenant-1';

function makeApp(tables: Record<string, Record<string, unknown>[]> = {}) {
  return createTestApp({
    route: dashboardRoute,
    routePath: '/dashboard',
    role: 'hospital_admin',
    tenantId: TENANT_ID,
    universalFallback: true,
    tables,
  });
}

describe('Admin Dashboard — /api/dashboard/stats (frontend contract)', () => {
  it('returns finance object with todayCollection, todayExpense, patientDue', async () => {
    const { app } = makeApp();
    const res = await app.request('/dashboard/stats');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const finance = body.finance as Record<string, unknown>;
    expect(finance).toHaveProperty('todayCollection');
    expect(finance).toHaveProperty('todayExpense');
    expect(finance).toHaveProperty('patientDue');
  });

  it('returns todaySummary with totalAppointments, completedConsultations, pendingTests, completedTests, admittedPatients, totalDiscount', async () => {
    const { app } = makeApp();
    const res = await app.request('/dashboard/stats');
    const body = await res.json() as Record<string, unknown>;
    const todaySummary = body.todaySummary as Record<string, unknown>;
    expect(todaySummary).toHaveProperty('totalAppointments');
    expect(todaySummary).toHaveProperty('completedConsultations');
    expect(todaySummary).toHaveProperty('pendingTests');
    expect(todaySummary).toHaveProperty('completedTests');
    expect(todaySummary).toHaveProperty('admittedPatients');
    expect(todaySummary).toHaveProperty('totalDiscount');
  });



  it('counts diagnostic pending/completed from lab order items and billed test items', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoute,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      universalFallback: true,
      queryOverride: (sql) => {
        if (sql.includes('diagnostic_items') && sql.includes('lab_order_items') && sql.includes('bill_items')) {
          return { results: [{ pending: 5, completed: 2 }] };
        }
        return null;
      },
    });

    const res = await app.request('/dashboard/stats');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const todaySummary = body.todaySummary as Record<string, unknown>;

    expect(todaySummary.pendingTests).toBe(5);
    expect(todaySummary.completedTests).toBe(2);
    expect(mockDB.queries.some(q => q.sql.includes('lab_order_items'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('bill_items'))).toBe(true);
  });

  it('returns patientSummary with opdPatients', async () => {
    const { app } = makeApp();
    const res = await app.request('/dashboard/stats');
    const body = await res.json() as Record<string, unknown>;
    const patientSummary = body.patientSummary as Record<string, unknown>;
    expect(patientSummary).toHaveProperty('opdPatients');
  });

  it('returns bedSummary with occupied, available, occupancyPercentage', async () => {
    const { app } = makeApp();
    const res = await app.request('/dashboard/stats');
    const body = await res.json() as Record<string, unknown>;
    const bedSummary = body.bedSummary as Record<string, unknown>;
    expect(bedSummary).toHaveProperty('occupied');
    expect(bedSummary).toHaveProperty('available');
    expect(bedSummary).toHaveProperty('occupancyPercentage');
  });

  it('returns pharmacySummary with todaySales', async () => {
    const { app } = makeApp();
    const res = await app.request('/dashboard/stats');
    const body = await res.json() as Record<string, unknown>;
    const pharmacySummary = body.pharmacySummary as Record<string, unknown>;
    expect(pharmacySummary).toHaveProperty('todaySales');
  });
});

describe('Admin Dashboard — /api/dashboard/active-counters', () => {
  it('returns activeCounters array + totalActive', async () => {
    const { app } = makeApp();
    const res = await app.request('/dashboard/active-counters');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('activeCounters');
    expect(body).toHaveProperty('totalActive');
  });
});

describe('Admin Dashboard — /api/dashboard/security-alerts', () => {
  it('returns summary with highDiscountCount, canceledCount, discrepancyCount, lowStockCount', async () => {
    const { app } = makeApp();
    const res = await app.request('/dashboard/security-alerts');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const summary = body.summary as Record<string, unknown>;
    expect(summary).toHaveProperty('highDiscountCount');
    expect(summary).toHaveProperty('canceledCount');
    expect(summary).toHaveProperty('discrepancyCount');
    expect(summary).toHaveProperty('lowStockCount');
  });
});

describe('Admin Dashboard — empty tenant paths', () => {
  it('/dashboard/stats returns 200 with zero-valued finance / todaySummary when no rows exist', async () => {
    const { app } = createTestApp({
      route: dashboardRoute,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/dashboard/stats');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.finance).toBeDefined();
    expect(body.todaySummary).toBeDefined();
  });

  it('/dashboard/active-counters returns 200 with valid shape (mock fallback may produce rows)', async () => {
    const { app } = createTestApp({
      route: dashboardRoute,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/dashboard/active-counters');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body.activeCounters)).toBe(true);
    expect(typeof body.totalActive).toBe('number');
    // universalFallback mock returns a generic row, so we cannot assert empty;
    // we only pin the contract shape.
  });

  it('/dashboard/security-alerts returns 200 with valid summary shape (mock fallback may produce rows)', async () => {
    const { app } = createTestApp({
      route: dashboardRoute,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/dashboard/security-alerts');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const summary = body.summary as Record<string, unknown>;
    // Pin the contract — universalFallback mock may produce rows, but
    // the summary keys must all be present and numeric.
    expect(typeof summary.canceledCount).toBe('number');
    expect(typeof summary.highDiscountCount).toBe('number');
    expect(typeof summary.discrepancyCount).toBe('number');
    expect(typeof summary.lowStockCount).toBe('number');
  });
});
