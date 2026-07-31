/**
 * RBAC 3-tier override chain tests.
 *
 * Validates the permission resolution hierarchy:
 *   1. Static role defaults (ROLE_PERMISSIONS in authz.ts)
 *   2. Tenant-level role overrides (role_permission_overrides table)
 *   3. User-level overrides (user_permission_overrides table)
 *
 * Also verifies hospital_admin bypass and tenant isolation.
 *
 * Since all tenant routes use requireRole() (not requirePermission()),
 * we test RBAC via two approaches:
 *   - Route-level: pharmacist CAN vs accountant CANNOT access /pharmacy/medicines
 *   - Middleware-level: requirePermission() via resolveUserPermissions with queryOverride
 */

import { describe, it, expect } from 'vitest';
import pharmacyRoutes from '../../src/routes/tenant/pharmacy';
import { createTestApp } from './helpers/test-app';
import { createMockDB } from './helpers/mock-db';
import { TENANT_1, TENANT_2 } from './helpers/fixtures';
import { resolveUserPermissions } from '../../src/middleware/rbac';

// ─── Route-level RBAC (requireRole) ──────────────────────────────────────────

describe('RBAC — Route-level role checks (pharmacy)', () => {
  it('static default: pharmacist can read pharmacy medicines', async () => {
    const { app } = createTestApp({
      route: pharmacyRoutes,
      routePath: '/pharmacy',
      role: 'pharmacist',
      tenantId: TENANT_1.id,
      tables: { medicines: [] },
    });

    const res = await app.request('/pharmacy/medicines');
    expect(res.status).toBe(200);
  });

  it('static default: accountant cannot read pharmacy medicines (403)', async () => {
    const { app } = createTestApp({
      route: pharmacyRoutes,
      routePath: '/pharmacy',
      role: 'accountant',
      tenantId: TENANT_1.id,
      tables: { medicines: [] },
    });

    const res = await app.request('/pharmacy/medicines');
    expect(res.status).toBe(403);
  });

  it('static default: doctor can read pharmacy medicines', async () => {
    const { app } = createTestApp({
      route: pharmacyRoutes,
      routePath: '/pharmacy',
      role: 'doctor',
      tenantId: TENANT_1.id,
      tables: { medicines: [] },
    });

    const res = await app.request('/pharmacy/medicines');
    expect(res.status).toBe(200);
  });

  it('static default: nurse can read pharmacy medicines', async () => {
    const { app } = createTestApp({
      route: pharmacyRoutes,
      routePath: '/pharmacy',
      role: 'nurse',
      tenantId: TENANT_1.id,
      tables: { medicines: [] },
    });

    const res = await app.request('/pharmacy/medicines');
    expect(res.status).toBe(200);
  });

  it('static default: hospital_admin always has access', async () => {
    const { app } = createTestApp({
      route: pharmacyRoutes,
      routePath: '/pharmacy',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: { medicines: [] },
    });

    const res = await app.request('/pharmacy/medicines');
    expect(res.status).toBe(200);
  });

  it('accountant cannot write pharmacy data (POST /medicines → 403)', async () => {
    const { app } = createTestApp({
      route: pharmacyRoutes,
      routePath: '/pharmacy',
      role: 'accountant',
      tenantId: TENANT_1.id,
      universalFallback: true,
    });

    const res = await app.request('/pharmacy/medicines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Med', generic_name: 'Test', form: 'Tablet', strength: '500mg' }),
    });
    expect(res.status).toBe(403);
  });

  it('doctor cannot write pharmacy data (POST /medicines → 403)', async () => {
    const { app } = createTestApp({
      route: pharmacyRoutes,
      routePath: '/pharmacy',
      role: 'doctor',
      tenantId: TENANT_1.id,
      universalFallback: true,
    });

    const res = await app.request('/pharmacy/medicines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Med', generic_name: 'Test', form: 'Tablet', strength: '500mg' }),
    });
    expect(res.status).toBe(403);
  });
});

// ─── Middleware-level RBAC (resolveUserPermissions) ──────────────────────────

describe('RBAC — 3-tier permission resolution (resolveUserPermissions)', () => {
  it('static defaults: pharmacist has pharmacy:read and pharmacy:write', async () => {
    const mockDB = createMockDB({
      tables: {},
      queryOverride: (sql) => {
        // No overrides in DB — fall through to static
        if (sql.includes('role_permission_overrides')) return { first: null };
        if (sql.includes('user_permission_overrides')) return { results: [] };
        return null;
      },
    });

    const perms = await resolveUserPermissions(mockDB.db, TENANT_1.id, 'pharmacist', '1');
    expect(perms).toContain('pharmacy:read');
    expect(perms).toContain('pharmacy:write');
  });

  it('static defaults: accountant does NOT have pharmacy:read', async () => {
    const mockDB = createMockDB({
      tables: {},
      queryOverride: (sql) => {
        if (sql.includes('role_permission_overrides')) return { first: null };
        if (sql.includes('user_permission_overrides')) return { results: [] };
        return null;
      },
    });

    const perms = await resolveUserPermissions(mockDB.db, TENANT_1.id, 'accountant', '1');
    expect(perms).not.toContain('pharmacy:read');
    expect(perms).not.toContain('pharmacy:write');
  });

  it('tenant override grants: accountant gets pharmacy:read via role_permission_overrides', async () => {
    const mockDB = createMockDB({
      tables: {},
      queryOverride: (sql) => {
        if (sql.includes('role_permission_overrides')) {
          return {
            first: {
              permissions: JSON.stringify([
                'dashboard:read', 'billing:read', 'pharmacy:read',
                'income:read', 'income:write', 'expenses:read', 'expenses:write',
                'accounting:read', 'accounting:write', 'reports:read', 'reports:write',
              ]),
            },
          };
        }
        if (sql.includes('user_permission_overrides')) return { results: [] };
        return null;
      },
    });

    const perms = await resolveUserPermissions(mockDB.db, TENANT_1.id, 'accountant', '1');
    expect(perms).toContain('pharmacy:read');
  });

  it('tenant override revokes: pharmacist loses pharmacy:read via override', async () => {
    const mockDB = createMockDB({
      tables: {},
      queryOverride: (sql) => {
        if (sql.includes('role_permission_overrides')) {
          // Tenant override for pharmacist removes pharmacy:read
          return {
            first: {
              permissions: JSON.stringify([
                'dashboard:read', 'pharmacy:write', 'patients:read', 'prescriptions:read',
              ]),
            },
          };
        }
        if (sql.includes('user_permission_overrides')) return { results: [] };
        return null;
      },
    });

    const perms = await resolveUserPermissions(mockDB.db, TENANT_1.id, 'pharmacist', '1');
    expect(perms).not.toContain('pharmacy:read');
    expect(perms).toContain('pharmacy:write');
  });

  it('user override grants: user-level grant beats tenant-level absence', async () => {
    const mockDB = createMockDB({
      tables: {},
      queryOverride: (sql) => {
        if (sql.includes('role_permission_overrides')) {
          // Tenant config does NOT include pharmacy:read for accountant
          return { first: null };
        }
        if (sql.includes('user_permission_overrides')) {
          return {
            results: [
              { permission: 'pharmacy:read', action: 'grant' },
            ],
          };
        }
        return null;
      },
    });

    const perms = await resolveUserPermissions(mockDB.db, TENANT_1.id, 'accountant', '42');
    expect(perms).toContain('pharmacy:read');
  });

  it('user override revokes: user-level revoke beats role default', async () => {
    const mockDB = createMockDB({
      tables: {},
      queryOverride: (sql) => {
        if (sql.includes('role_permission_overrides')) return { first: null };
        if (sql.includes('user_permission_overrides')) {
          return {
            results: [
              { permission: 'pharmacy:read', action: 'revoke' },
            ],
          };
        }
        return null;
      },
    });

    const perms = await resolveUserPermissions(mockDB.db, TENANT_1.id, 'pharmacist', '10');
    expect(perms).not.toContain('pharmacy:read');
    expect(perms).toContain('pharmacy:write');
  });

  it('admin bypass: hospital_admin always gets wildcard, ignores overrides', async () => {
    // resolveUserPermissions short-circuits for hospital_admin in requirePermission,
    // but when called directly, it still resolves. The middleware itself bypasses.
    // We verify the static permissions include '*'.
    const mockDB = createMockDB({
      tables: {},
      queryOverride: (sql) => {
        if (sql.includes('role_permission_overrides')) return { first: null };
        if (sql.includes('user_permission_overrides')) return { results: [] };
        return null;
      },
    });

    const perms = await resolveUserPermissions(mockDB.db, TENANT_1.id, 'hospital_admin', '1');
    expect(perms).toContain('*');
  });

  it('tenant isolation: tenant-2 override does not affect tenant-1', async () => {
    // The queryOverride simulates the DB returning results filtered by tenant_id.
    // For tenant-1, there is no override; for tenant-2, accountant gets pharmacy:read.
    const mockDB = createMockDB({
      tables: {},
      queryOverride: (sql, params) => {
        if (sql.includes('role_permission_overrides')) {
          const tenantParam = params[0];
          if (tenantParam === TENANT_2.id) {
            return {
              first: {
                permissions: JSON.stringify([
                  'dashboard:read', 'billing:read', 'pharmacy:read',
                  'income:read', 'expenses:read', 'accounting:read', 'reports:read',
                ]),
              },
            };
          }
          // Tenant-1 has no override
          return { first: null };
        }
        if (sql.includes('user_permission_overrides')) return { results: [] };
        return null;
      },
    });

    // Tenant-2 accountant gets pharmacy:read
    const permsTenant2 = await resolveUserPermissions(mockDB.db, TENANT_2.id, 'accountant', '1');
    expect(permsTenant2).toContain('pharmacy:read');

    // Tenant-1 accountant does NOT get pharmacy:read
    const permsTenant1 = await resolveUserPermissions(mockDB.db, TENANT_1.id, 'accountant', '1');
    expect(permsTenant1).not.toContain('pharmacy:read');
  });
});
