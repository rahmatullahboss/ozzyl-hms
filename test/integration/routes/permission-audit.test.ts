import { describe, expect, it } from 'vitest';
import permissionRoutes from '../../../src/routes/tenant/permissions.ts';
import { createTestApp, jsonRequest } from '../helpers/test-app';

describe('permission management audit trail', () => {
  it('records an audit log when role permissions are changed', async () => {
    const { app, mockDB } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
    });

    const res = await jsonRequest(app, '/permissions/role', {
      method: 'PUT',
      body: { role: 'accountant', permissions: ['accounting:read', 'audit:read'] },
    });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO audit_logs') && q.params.includes('role_permission_overrides'))).toBe(true);
  });

  it('records an audit log when user permission overrides are changed', async () => {
    const { app, mockDB } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      tables: {
        users: [{ id: 22, name: 'Accountant', email: 'acct@example.com', role: 'accountant', tenant_id: 'tenant-1' }],
      },
    });

    const res = await jsonRequest(app, '/permissions/user/override', {
      method: 'POST',
      body: { user_id: 22, permission: 'lab:read', action: 'grant', reason: 'Monthly lab access review' },
    });

    expect(res.status).toBe(200);
    const auditInsert = mockDB.queries.find((q) => q.method === 'run' && q.sql.includes('INSERT INTO audit_logs') && q.params.includes('user_permission_overrides'));
    expect(auditInsert).toBeDefined();
    const oldValue = JSON.parse(String(auditInsert?.params[5] ?? '{}')) as Record<string, unknown>;
    const newValue = JSON.parse(String(auditInsert?.params[6] ?? '{}')) as Record<string, unknown>;
    expect(oldValue).toEqual(expect.any(Object));
    expect(newValue).toMatchObject({
      auditEventType: 'permission_grant',
      whoChanged: '1',
      whoseAccessChanged: { type: 'user', id: 22 },
      whatChanged: {
        userId: 22,
        permission: 'lab:read',
        action: 'grant',
        criticalPermission: false,
      },
      before: { userId: 22, permission: 'lab:read', override: null },
      after: { userId: 22, permission: 'lab:read', action: 'grant', reason: 'Monthly lab access review', grantedBy: '1' },
      reason: 'Monthly lab access review',
      criticalPermissionChange: false,
      criticalPermissionsChanged: [],
    });
    expect(typeof newValue.timestamp).toBe('string');
    expect(newValue.device).toMatchObject({ ipAddress: '[REDACTED]', userAgent: null });
  });
});
