import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { centralRoutePermission, getRequiredRoutePermission } from '../../../src/lib/route-permissions';
import { ALL_PERMISSIONS, getPermissionsForRole, PERMISSION_GROUPS } from '../../../packages/shared/src/authz';
import hrRoutes from '../../../src/routes/tenant/hr';
import staffRoutes from '../../../src/routes/tenant/staff';
import type { Env, Variables } from '../../../src/types';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { createMockDB, createMockKV } from '../helpers/mock-db';

const ROUTE_CASES = [
  ['GET', '/api/staff', 'workforce:read'],
  ['POST', '/api/staff', 'workforce:write'],
  ['DELETE', '/api/staff/1', 'workforce:deactivate'],
  ['GET', '/api/staff/salary-report', 'staff:read'],
  ['GET', '/api/staff/1/salary', 'staff:read'],
  ['POST', '/api/staff/1/salary', 'staff:write'],
  ['POST', '/api/staff/1/invite', 'staff:write'],
  ['GET', '/api/hr/roster', 'roster:read'],
  ['POST', '/api/hr/roster', 'roster:write'],
  ['PUT', '/api/hr/roster/1/swap', 'roster:swap'],
  ['DELETE', '/api/hr/roster/1', 'roster:cancel'],
  ['POST', '/api/hr/roster/generate', 'roster:generate'],
  ['PATCH', '/api/hr/leave/requests/1/approve', 'leave:approve'],
  ['POST', '/api/hr/biometric/punch/manual', 'attendance:correct'],
  ['POST', '/api/hr/biometric/punch', 'attendance:write'],
  ['GET', '/api/hr/biometric/punches', 'attendance:read'],
  ['POST', '/api/hr/biometric/devices', 'biometric:manage'],
  ['PUT', '/api/hr/biometric/overtime/1/approve', 'overtime:approve'],
] as const;

function createCentralRbacHarness(role: string) {
  const mockDB = createMockDB({
    tables: {
      role_permission_overrides: [],
      user_permission_overrides: [],
    },
  });
  const mockKV = createMockKV();
  let handlerCalls = 0;

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1');
    c.set('userId', '7');
    c.set('role', role as Variables['role']);
    c.env = {
      DB: mockDB.db,
      KV: mockKV.kv,
      JWT_SECRET: 'test-secret',
      ENVIRONMENT: 'test',
    } as unknown as Env;
    await next();
  });
  app.use('/api/*', centralRoutePermission({ mode: 'enforce' }));
  app.all('*', (c) => {
    handlerCalls += 1;
    return c.json({ ok: true });
  });

  return { app, mockDB, getHandlerCalls: () => handlerCalls };
}

describe('workforce central permission matrix', () => {
  it.each(ROUTE_CASES)('%s %s resolves and denies without %s before any mutation', async (method, path, permission) => {
    expect(getRequiredRoutePermission(path, method)).toMatchObject({ permission: [permission] });

    const { app, mockDB, getHandlerCalls } = createCentralRbacHarness('reception');
    const response = await app.request(path, { method });

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toContain(permission);
    expect(getHandlerCalls()).toBe(0);
    expect(mockDB.queries.some((query) => /^(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(query.sql.trim()))).toBe(false);
  });

  it('preserves the hospital_admin wildcard for exact workforce rules', async () => {
    const { app, getHandlerCalls } = createCentralRbacHarness('hospital_admin');
    const response = await app.request('/api/hr/roster/generate', { method: 'POST' });

    expect(response.status).toBe(200);
    expect(getHandlerCalls()).toBe(1);
  });
});

describe('workforce permission catalog', () => {
  it('publishes the granular permissions to role defaults and the admin permission group', () => {
    const required = [
      'workforce:read', 'workforce:write', 'workforce:deactivate',
      'roster:read', 'roster:write', 'roster:swap', 'roster:cancel', 'roster:generate',
      'calendar:read', 'calendar:write',
      'attendance:read', 'attendance:write', 'attendance:correct',
      'leave:read', 'leave:request', 'leave:approve',
      'biometric:read', 'biometric:manage',
      'overtime:read', 'overtime:write', 'overtime:approve',
    ];

    expect(ALL_PERMISSIONS).toEqual(expect.arrayContaining(required));
    expect(PERMISSION_GROUPS.hr.permissions).toEqual(expect.arrayContaining(required));
    expect(getPermissionsForRole('md')).toEqual(expect.arrayContaining(required));
    expect(getPermissionsForRole('director')).toEqual(expect.arrayContaining(required));
  });
});

describe('workforce route-level guards', () => {
  it('denies roster mutation before the roster route prepares a business mutation', async () => {
    const { app, mockDB } = createTestApp({
      route: hrRoutes,
      routePath: '/api/hr',
      role: 'reception',
      tenantId: 'tenant-1',
      userId: 7,
      tables: {
        role_permission_overrides: [],
        user_permission_overrides: [],
      },
    });

    const response = await jsonRequest(app, '/api/hr/roster', {
      method: 'POST',
      body: {
        staffId: 1,
        shiftId: 1,
        rosterDate: '2026-07-27',
        idempotencyKey: 'rbac-denial-check',
      },
    });

    expect(response.status).toBe(403);
    expect(mockDB.queries.some((query) => /INSERT INTO hr_duty_roster/i.test(query.sql))).toBe(false);
  });

  it('creates an operational staff profile without creating or linking a canonical practitioner', async () => {
    const { app, mockDB } = createTestApp({
      route: staffRoutes,
      routePath: '/api/staff',
      role: 'reception',
      tenantId: 'tenant-1',
      userId: 7,
      tables: {
        role_permission_overrides: [],
        user_permission_overrides: [
          {
            tenant_id: 'tenant-1',
            user_id: '7',
            permission: 'workforce:write',
            action: 'grant',
          },
        ],
        staff: [],
        audit_logs: [],
      },
    });

    const response = await jsonRequest(app, '/api/staff', {
      method: 'POST',
      body: { name: 'New Receptionist', position: 'Receptionist' },
    });

    expect(response.status).toBe(201);
    expect(mockDB.queries.some((query) =>
      /^(INSERT|UPDATE|DELETE)\b/i.test(query.sql.trim())
      && /canonical_practitioner|practitioner_employee_links/i.test(query.sql),
    )).toBe(false);
  });

  it('does not let a legacy staff:read grant expose another staff profile', async () => {
    const { app } = createTestApp({
      route: staffRoutes,
      routePath: '/api/staff',
      role: 'reception',
      tenantId: 'tenant-1',
      userId: 7,
      tables: {
        role_permission_overrides: [],
        user_permission_overrides: [
          {
            tenant_id: 'tenant-1',
            user_id: '7',
            permission: 'staff:read',
            action: 'grant',
          },
        ],
        staff: [
          {
            id: 2,
            tenant_id: 'tenant-1',
            name: 'Other Staff',
            position: 'Nurse',
            status: 'active',
          },
        ],
      },
    });

    const response = await app.request('/api/staff/2');
    expect(response.status).toBe(403);
  });
});
