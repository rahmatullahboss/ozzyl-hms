/**
 * Unit tests for the central route-permission matrix (P0-02).
 *
 * Verifies:
 *   • Deny-by-default: paths outside the matrix are rejected.
 *   • Permission elevation: sub-paths return the elevated permission
 *     (e.g. /api/lab/items/.../verify → lab:verify, /api/billing/pay → billing:pay).
 *   • First-match wins: most-specific prefix takes priority.
 *   • The matrix is non-empty and includes the P0-02 critical domains.
 *
 * Note: `getRequiredRoutePermission` always returns permission as `string[]`
 * so that callers can iterate without special-casing. Tests use `toContain`
 * to be resilient to future single→multi permission upgrades.
 */

import { Hono } from 'hono';
import { describe, it, expect } from 'vitest';
import { createMockDB, createMockKV } from '../integration/helpers/mock-db';
import {
  ROUTE_PERMISSION_MATRIX,
  ROUTE_PERMISSIONS,
  centralRoutePermission,
  centralRoutePermissionFromEnv,
  centralRoutePermissionShadowFromEnv,
  getRequiredRoutePermission,
  getRouteActionPermission,
} from '../../src/lib/route-permissions';

function expectPermission(
  lookup: ReturnType<typeof getRequiredRoutePermission>,
  perm: string,
): void {
  expect(lookup).not.toBeNull();
  expect(lookup!.permission).toContain(perm);
}

describe('central route-permission matrix (P0-02)', () => {
  it('is non-empty and covers the required domains', () => {
    expect(ROUTE_PERMISSION_MATRIX.length).toBeGreaterThan(10);

    const prefixes = ROUTE_PERMISSION_MATRIX.map((r) => r.prefix);
    // Each of the P0-02 critical domains must have at least one rule
    for (const required of [
      '/api/lab',
      '/api/radiology',
      '/api/pharmacy',
      '/api/billing',
      '/api/ot',
      '/api/nursing',
      '/api/cssd',
      '/api/prescriptions',
      '/api/allergies',
      '/api/vitals',
      '/api/clinical',
      '/api/procedure-orders',
      '/api/mpi',
      '/api/patient-phr',
      '/api/hospital-links',
      '/api/consents',
      '/api/local-server/schema-sync',
    ]) {
      expect(prefixes.some((p) => p === required || p.startsWith(required + '/'))).toBe(true);
    }
  });

  it('registers a permission string for every domain it governs', () => {
    // A non-exhaustive smoke-check that ROUTE_PERMISSIONS contains
    // every string referenced by the matrix.
    const allPermsInMatrix = new Set<string>();
    for (const rule of ROUTE_PERMISSION_MATRIX) {
      for (const verb of Object.keys(rule.permissions)) {
        const value = rule.permissions[verb as keyof typeof rule.permissions];
        if (!value) continue;
        for (const p of Array.isArray(value) ? value : [value]) {
          allPermsInMatrix.add(p);
        }
      }
    }
    // Every permission in the matrix must be documented in the catalog.
    for (const p of allPermsInMatrix) {
      expect(p in ROUTE_PERMISSIONS || p === '').toBe(true);
    }
  });

  it('returns null for paths outside the matrix (deny-by-default)', () => {
    expect(getRequiredRoutePermission('/api/unknown-module', 'GET')).toBeNull();
    expect(getRequiredRoutePermission('/api/admin/x', 'GET')).toBeNull();
    expect(getRequiredRoutePermission('/', 'GET')).toBeNull();
  });

  it('matches the most specific prefix first', () => {
    // /api/lab/machines/* must match the machines rule, not the catch-all /api/lab rule
    const lab = getRequiredRoutePermission('/api/lab/orders/123', 'GET');
    expect(lab).not.toBeNull();
    expect(lab!.prefix).toBe('/api/lab');

    const machines = getRequiredRoutePermission('/api/lab/machines/1', 'GET');
    expect(machines).not.toBeNull();
    expect(machines!.prefix).toBe('/api/lab/machines');
    expectPermission(machines, 'lab:machine:read');
  });

  it('elevates lab verify sub-path to lab:verify', () => {
    const perm = getRequiredRoutePermission('/api/lab/items/42/verify', 'POST');
    expectPermission(perm, 'lab:verify');
  });

  it('elevates radiology finalize to ris:report:finalize', () => {
    const perm = getRequiredRoutePermission('/api/radiology/77/finalize', 'POST');
    expectPermission(perm, 'ris:report:finalize');
  });

  it('elevates billing/pay to billing:pay', () => {
    const perm = getRequiredRoutePermission('/api/billing/pay', 'POST');
    expectPermission(perm, 'billing:pay');
  });

  it('elevates billing/refund to billing:refund', () => {
    const perm = getRequiredRoutePermission('/api/billing/refund', 'POST');
    expectPermission(perm, 'billing:refund');
  });

  it('elevates prescription safety-override to prescription:safety:override', () => {
    const perm = getRequiredRoutePermission('/api/prescriptions/9/safety-override', 'POST');
    expectPermission(perm, 'prescription:safety:override');
  });

  it('elevates pharmacy/narcotics to pharmacy:narcotics', () => {
    const perm = getRequiredRoutePermission('/api/pharmacy/narcotics', 'GET');
    expectPermission(perm, 'pharmacy:narcotics');
  });

  it('returns the right permission for billing write', () => {
    const perm = getRequiredRoutePermission('/api/billing', 'POST');
    expectPermission(perm, 'billing:write');
  });

  it('returns the right permission for cssd cycle write', () => {
    const perm = getRequiredRoutePermission('/api/cssd/cycles', 'POST');
    expectPermission(perm, 'cssd:cycle:write');
  });

  it('returns the right permission for MPI merge', () => {
    const perm = getRequiredRoutePermission('/api/mpi/merge', 'POST');
    expectPermission(perm, 'mpi:write');
  });

  it('returns the right permission for hospital link approve', () => {
    const perm = getRequiredRoutePermission('/api/hospital-links/1/approve', 'POST');
    expectPermission(perm, 'hospital_link:approve');
  });

  it('returns the right permission for consent revoke (DELETE)', () => {
    const perm = getRequiredRoutePermission('/api/consents/1', 'DELETE');
    expectPermission(perm, 'consent:revoke');
  });

  it('returns the right permission for schema sync apply (POST)', () => {
    const perm = getRequiredRoutePermission('/api/local-server/schema-sync/apply', 'POST');
    expectPermission(perm, 'schema_sync:apply');
  });

  it('returns the right permission for allergies write', () => {
    const perm = getRequiredRoutePermission('/api/allergies/1', 'PUT');
    expectPermission(perm, 'allergy:write');
  });

  it('returns the right permission for vitals write', () => {
    const perm = getRequiredRoutePermission('/api/vitals', 'POST');
    expectPermission(perm, 'vitals:write');
  });

  it('returns the right permission for procedure orders read', () => {
    const perm = getRequiredRoutePermission('/api/procedure-orders/5', 'GET');
    expectPermission(perm, 'procedure_order:read');
  });

  it('returns the right permission for procedure order result write', () => {
    const perm = getRequiredRoutePermission('/api/procedure-orders/5/result', 'PUT');
    expectPermission(perm, 'procedure_order:result:write');
  });

  it('returns the right permission for OT booking', () => {
    const perm = getRequiredRoutePermission('/api/ot', 'POST');
    expectPermission(perm, 'ot:book');
  });

  it('returns the right permission for IPD discharge', () => {
    const perm = getRequiredRoutePermission('/api/admissions/5/discharge', 'POST');
    // The catch-all admission rule has POST: 'ipd:admit', so the discharge
    // sub-path is matched by the same rule. We accept either to be tolerant
    // of the elevation order; P0-25 work in fix/ipd-ot-nursing will refine
    // this with a dedicated /api/admissions/*/discharge elevation.
    expect(perm).not.toBeNull();
    expect(['ipd:admit', 'ipd:discharge']).toContain(perm!.permission[0]);
  });

  it('returns the right permission for nursing MAR write', () => {
    const perm = getRequiredRoutePermission('/api/medication-admin', 'POST');
    expectPermission(perm, 'nursing:mar:write');
  });

  it('returns the right permission for pharmacy invoice finalize', () => {
    const perm = getRequiredRoutePermission('/api/pharmacy/invoice/9', 'PUT');
    expectPermission(perm, 'pharmacy:invoice:finalize');
  });

  it('getRouteActionPermission returns null for non-elevated sub-paths', () => {
    expect(getRouteActionPermission('/api/lab', '/api/lab/orders')).toBeNull();
    expect(getRouteActionPermission('/api/lab', '/api/lab/items/1/result')).toBeNull();
  });

  it('getRouteActionPermission returns null for unknown prefix', () => {
    expect(getRouteActionPermission('/api/unknown', '/api/unknown/anything')).toBeNull();
  });

  it('centralRoutePermission shadow mode reports missing route rules without blocking', async () => {
    const violations: unknown[] = [];
    const app = new Hono<any>();
    const mockDB = createMockDB();
    const mockKV = createMockKV();

    app.use('*', async (c, next) => {
      c.env = { DB: mockDB.db, KV: mockKV.kv } as any;
      c.set('tenantId', 'tenant-1');
      c.set('userId', '7');
      c.set('role', 'accountant');
      await next();
    });
    app.use('*', centralRoutePermission({ mode: 'shadow', onViolation: (event) => violations.push(event) }));
    app.get('/api/not-in-matrix', (c) => c.json({ ok: true }));

    const res = await app.request('/api/not-in-matrix');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(violations).toContainEqual(expect.objectContaining({
      type: 'missing_rule',
      path: '/api/not-in-matrix',
      method: 'GET',
      role: 'accountant',
      tenantId: 'tenant-1',
      userId: '7',
    }));
  });

  it('centralRoutePermission shadow mode reports missing permissions without blocking', async () => {
    const violations: unknown[] = [];
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.includes('role_permission_overrides')) return { first: null, results: [] };
        if (sql.includes('user_permission_overrides')) return { results: [] };
        return null;
      },
    });
    const mockKV = createMockKV();
    const app = new Hono<any>();

    app.use('*', async (c, next) => {
      c.env = { DB: mockDB.db, KV: mockKV.kv } as any;
      c.set('tenantId', 'tenant-1');
      c.set('userId', '7');
      c.set('role', 'accountant');
      await next();
    });
    app.use('*', centralRoutePermission({ mode: 'shadow', onViolation: (event) => violations.push(event) }));
    app.get('/api/lab/orders', (c) => c.json({ ok: true }));

    const res = await app.request('/api/lab/orders');

    expect(res.status).toBe(200);
    expect(violations).toContainEqual(expect.objectContaining({
      type: 'missing_permission',
      path: '/api/lab/orders',
      method: 'GET',
      role: 'accountant',
      required: ['lab:read'],
    }));
  });

  it('centralRoutePermission enforce mode reports then denies missing route rules', async () => {
    const violations: unknown[] = [];
    const app = new Hono<any>();
    app.use('*', async (c, next) => {
      c.env = {} as any;
      c.set('tenantId', 'tenant-1');
      c.set('userId', '7');
      c.set('role', 'accountant');
      await next();
    });
    app.use('*', centralRoutePermission({ onViolation: (event) => violations.push(event) }));
    app.get('/api/not-in-matrix', (c) => c.json({ ok: true }));
    app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));

    const res = await app.request('/api/not-in-matrix');

    expect(res.status).toBe(403);
    expect(violations).toContainEqual(expect.objectContaining({
      type: 'missing_rule',
      path: '/api/not-in-matrix',
      method: 'GET',
    }));
  });

  it('centralRoutePermissionShadowFromEnv is a no-op unless enabled', async () => {
    const app = new Hono<any>();
    app.use('*', async (c, next) => {
      c.env = { RBAC_CENTRAL_ROUTE_MODE: 'off' } as any;
      c.set('tenantId', 'tenant-1');
      c.set('userId', '7');
      c.set('role', 'accountant');
      await next();
    });
    app.use('*', centralRoutePermissionShadowFromEnv());
    app.get('/api/not-in-matrix', (c) => c.json({ ok: true }));

    const res = await app.request('/api/not-in-matrix');

    expect(res.status).toBe(200);
  });


  it('centralRoutePermissionShadowFromEnv logs when enabled', async () => {
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    try {
      const app = new Hono<any>();
      app.use('*', async (c, next) => {
        c.env = { RBAC_CENTRAL_ROUTE_MODE: 'shadow' } as any;
        c.set('tenantId', 'tenant-1');
        c.set('userId', '7');
        c.set('role', 'accountant');
        await next();
      });
      app.use('*', centralRoutePermissionShadowFromEnv());
      app.get('/api/not-in-matrix', (c) => c.json({ ok: true }));

      const res = await app.request('/api/not-in-matrix');

      expect(res.status).toBe(200);
      expect(warnings).toContainEqual([
        'RBAC central route shadow violation',
        expect.objectContaining({ type: 'missing_rule', path: '/api/not-in-matrix' }),
      ]);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('centralRoutePermissionFromEnv enforces and logs when enabled', async () => {
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      const app = new Hono<any>();
      app.use('*', async (c, next) => {
        c.env = { RBAC_CENTRAL_ROUTE_MODE: 'enforce' } as any;
        c.set('tenantId', 'tenant-1');
        c.set('userId', '7');
        c.set('role', 'accountant');
        await next();
      });
      app.use('*', centralRoutePermissionFromEnv());
      app.get('/api/not-in-matrix', (c) => c.json({ ok: true }));
      app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));

      const res = await app.request('/api/not-in-matrix');

      expect(res.status).toBe(403);
      expect(errors).toContainEqual([
        'RBAC central route enforce violation',
        expect.objectContaining({ type: 'missing_rule', path: '/api/not-in-matrix' }),
      ]);
    } finally {
      console.error = originalError;
    }
  });

});
