import { describe, expect, it } from 'vitest';
import userRoutes from '../../../src/routes/tenant/users';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { createMockKV } from '../helpers/mock-db';

describe('user RBAC safety', () => {
  it('invalidates old and new role permission caches when a user role changes', async () => {
    const mockKV = createMockKV({
      'rbac:perms:tenant-1:manager:22': '["dashboard:read","reports:read"]',
      'rbac:perms:tenant-1:accountant:22': '["accounting:read"]',
      'rbac:perms:tenant-1:manager:99': '["dashboard:read"]',
      'auth:user-state:tenant-1:22': '{"exists":true,"role":"manager","isActive":true}',
    });
    const { app } = createTestApp({
      route: userRoutes,
      routePath: '/users',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      mockKV,
      tables: {
        users: [{ id: 22, name: 'Manager', email: 'manager@example.com', role: 'manager', tenant_id: 'tenant-1' }],
      },
    });

    const res = await jsonRequest(app, '/users/22/role', {
      method: 'PATCH',
      body: { role: 'accountant' },
    });

    expect(res.status).toBe(200);
    expect(mockKV.store.has('rbac:perms:tenant-1:manager:22')).toBe(false);
    expect(mockKV.store.has('rbac:perms:tenant-1:accountant:22')).toBe(false);
    expect(mockKV.store.has('rbac:perms:tenant-1:manager:99')).toBe(true);
    expect(mockKV.store.has('auth:user-state:tenant-1:22')).toBe(false);
  });

  it('invalidates cached active-user state when a user is deactivated', async () => {
    const mockKV = createMockKV({
      'auth:user-state:tenant-1:22': '{"exists":true,"role":"reception","isActive":true}',
    });
    const { app } = createTestApp({
      route: userRoutes,
      routePath: '/users',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      mockKV,
      tables: {
        users: [{ id: 22, name: 'Reception', email: 'reception@example.com', role: 'reception', tenant_id: 'tenant-1' }],
      },
    });

    const res = await app.request('/users/22', { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(mockKV.store.has('auth:user-state:tenant-1:22')).toBe(false);
  });

  it('invalidates cached inactive-user state when a user is reactivated', async () => {
    const mockKV = createMockKV({
      'auth:user-state:tenant-1:22': '{"exists":true,"role":"reception","isActive":false}',
    });
    const { app } = createTestApp({
      route: userRoutes,
      routePath: '/users',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      mockKV,
      tables: {
        users: [{ id: 22, name: 'Reception', role: 'reception', is_active: 0, tenant_id: 'tenant-1' }],
      },
    });

    const res = await app.request('/users/22/activate', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(mockKV.store.has('auth:user-state:tenant-1:22')).toBe(false);
  });

  it('does not allow tenant admins to promote a user into hospital_admin wildcard access', async () => {
    const { app } = createTestApp({
      route: userRoutes,
      routePath: '/users',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: {
        users: [{ id: 22, name: 'Reception', email: 'reception@example.com', role: 'reception', tenant_id: 'tenant-1' }],
      },
    });

    const res = await jsonRequest(app, '/users/22/role', {
      method: 'PATCH',
      body: { role: 'hospital_admin' },
    });

    expect(res.status).toBe(400);
  });
});
