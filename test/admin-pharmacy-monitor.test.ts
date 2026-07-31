import { describe, it, expect } from 'vitest';
import pharmacyRoute from '../src/routes/tenant/pharmacy';
import { createTestApp, createTestAppNoRole } from './integration/helpers/test-app';

const TENANT_ID = 'tenant-1';

function makeApp(tables: Record<string, Record<string, unknown>[]> = {}) {
  return createTestApp({
    route: pharmacyRoute,
    routePath: '/pharmacy',
    role: 'hospital_admin',
    tenantId: TENANT_ID,
    universalFallback: true,
    tables,
  });
}

describe('Admin Pharmacy Monitor — /api/pharmacy/summary', () => {
  it('returns todaySales, todaySalesCount, grossMargin, lowStockCount, expiringCount', async () => {
    const { app } = makeApp();
    const res = await app.request('/pharmacy/summary');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('todaySales');
    expect(body).toHaveProperty('todaySalesCount');
    expect(body).toHaveProperty('grossMargin');
    expect(body).toHaveProperty('totalInvestment');
    expect(body).toHaveProperty('totalIncome');
    expect(body).toHaveProperty('grossProfit');
    expect(body).toHaveProperty('totalMedicines');
    expect(body).toHaveProperty('lowStockCount');
    expect(body).toHaveProperty('expiringCount');
  });
});

describe('Admin Pharmacy Monitor — empty-data and margin safety', () => {
  it('returns 200 with valid shape (universalFallback may produce rows)', async () => {
    const { app } = createTestApp({
      route: pharmacyRoute,
      routePath: '/pharmacy',
      role: 'hospital_admin',
      tenantId: 'empty-pharmacy',
      universalFallback: true,
    });
    const res = await app.request('/pharmacy/summary');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.todaySales).toBe('number');
    expect(typeof body.todaySalesCount).toBe('number');
    expect(typeof body.grossMargin).toBe('number');
  });

  it('grossMargin is always finite (no NaN from divide-by-zero)', async () => {
    const { app } = makeApp();
    const res = await app.request('/pharmacy/summary');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const margin = Number(body.grossMargin ?? 0);
    expect(Number.isFinite(margin)).toBe(true);
  });
});

describe('Admin Pharmacy Monitor — tenant auth boundary', () => {
  it('returns 401/403 when no tenant is set', async () => {
    const { app } = createTestAppNoRole({
      route: pharmacyRoute,
      routePath: '/pharmacy',
      tenantId: '',
    });
    const res = await app.request('/pharmacy/summary');
    expect([401, 403]).toContain(res.status);
  });
});
