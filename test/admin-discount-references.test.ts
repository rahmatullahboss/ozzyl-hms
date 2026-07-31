import { describe, it, expect } from 'vitest';
import adminRoute from '../src/routes/admin/index';
import { createTestApp, createTestAppNoRole } from './integration/helpers/test-app';

const TENANT_ID = 'tenant-1';

function makeApp(tables: Record<string, Record<string, unknown>[]> = {}) {
  return createTestApp({
    route: adminRoute,
    routePath: '/admin',
    role: 'hospital_admin',
    tenantId: TENANT_ID,
    universalFallback: true,
    tables,
  });
}

describe('Admin Discount Reference Analytics — /api/admin/discount-references', () => {
  it('returns references and staff arrays + summary', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/discount-references');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('references');
    expect(Array.isArray(body.references)).toBe(true);
    expect(body).toHaveProperty('staff');
    expect(Array.isArray(body.staff)).toBe(true);
    const summary = body.summary as Record<string, unknown>;
    expect(summary).toHaveProperty('totalReferences');
    expect(summary).toHaveProperty('totalStaff');
    expect(summary).toHaveProperty('totalDiscountAmount');
    expect(summary).toHaveProperty('highDiscountCount');
  });
});

describe('Admin Discount References — empty-data path', () => {
  it('returns 200 with valid shape (catch block returns empty defaults)', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/admin/discount-references');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body.references)).toBe(true);
    expect(Array.isArray(body.staff)).toBe(true);
    const summary = body.summary as Record<string, unknown>;
    // Pin the keys that must be present; universalFallback may return
    // null for highDiscountCount when the underlying row has no field.
    expect(summary).toHaveProperty('totalReferences');
    expect(summary).toHaveProperty('totalStaff');
    expect(summary).toHaveProperty('totalDiscountAmount');
    expect(summary).toHaveProperty('highDiscountCount');
  });
});

describe('Admin Discount References — tenant auth boundary', () => {
  it('returns 401/403 when no tenant is set', async () => {
    const { app } = createTestAppNoRole({
      route: adminRoute,
      routePath: '/admin',
      tenantId: '',
    });
    const res = await app.request('/admin/discount-references');
    expect([401, 403]).toContain(res.status);
  });
});
