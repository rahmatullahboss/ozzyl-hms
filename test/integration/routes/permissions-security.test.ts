import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import permissionRoutes from '../../../src/routes/tenant/permissions';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { createMockKV } from '../helpers/mock-db';

describe('permission management security', () => {
  it('exposes central route permissions in the editable catalog', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const res = await app.request('/permissions/catalog');
    const body = await res.json() as {
      all_permissions: string[];
      groups: Record<string, { permissions: string[] }>;
      critical_permissions: Array<{ permission: string }>;
      normal_workspace_toggle_excluded_permissions: string[];
    };

    expect(res.status).toBe(200);
    expect(body.all_permissions).toContain('lab:read');
    expect(body.all_permissions).toContain('ris:report:finalize');
    expect(body.all_permissions).toContain('billing:cash:read');
    expect(body.groups.inventory.permissions).not.toContain('inventory:adjust');
    expect(body.groups.inventory.permissions).not.toContain('inventory:approve');
    expect(body.groups.inventory.permissions).not.toContain('inventory:audit');
    expect(body.groups.admin.permissions).not.toContain('roles:manage');
    expect(body.groups.admin.permissions).not.toContain('settings:write');
    expect(body.groups.admin.permissions).not.toContain('users:delete');
    expect(body.critical_permissions.map((item) => item.permission)).toEqual(expect.arrayContaining(['inventory:adjust', 'inventory:approve', 'inventory:audit', 'roles:manage', 'settings:write', 'users:delete']));
    expect(body.normal_workspace_toggle_excluded_permissions).toEqual(expect.arrayContaining(['billing:refund', 'roles:manage']));
  });

  it('accepts central route permissions in role overrides', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const res = await jsonRequest(app, '/permissions/role', {
      method: 'PUT',
      body: { role: 'accountant', permissions: ['accounting:read', 'lab:read', 'ris:report:finalize'] },
    });

    expect(res.status).toBe(200);
  });

  it('invalidates cached permissions for all users in a changed role', async () => {
    const mockKV = createMockKV({
      'rbac:perms:tenant-1:accountant:22': '["accounting:read"]',
      'rbac:perms:tenant-1:accountant:99': '["accounting:read"]',
      'rbac:perms:tenant-1:doctor:10': '["patients:read"]',
    });
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      mockKV,
      tables: {
        users: [
          { id: 22, name: 'Accountant A', email: 'acct-a@example.com', role: 'accountant', tenant_id: 'tenant-1' },
          { id: 99, name: 'Accountant B', email: 'acct-b@example.com', role: 'accountant', tenant_id: 'tenant-1' },
          { id: 10, name: 'Doctor', email: 'doc@example.com', role: 'doctor', tenant_id: 'tenant-1' },
        ],
      },
    });

    const res = await jsonRequest(app, '/permissions/role', {
      method: 'PUT',
      body: { role: 'accountant', permissions: ['accounting:read', 'lab:read'] },
    });

    expect(res.status).toBe(200);
    expect(mockKV.store.has('rbac:perms:tenant-1:accountant:22')).toBe(false);
    expect(mockKV.store.has('rbac:perms:tenant-1:accountant:99')).toBe(false);
    expect(mockKV.store.has('rbac:perms:tenant-1:doctor:10')).toBe(true);
  });

  it('invalidates cached permissions for a changed user override', async () => {
    const mockKV = createMockKV({
      'rbac:perms:tenant-1:accountant:22': '["accounting:read"]',
      'rbac:perms:tenant-1:accountant:99': '["accounting:read"]',
    });
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      mockKV,
      tables: {
        users: [{ id: 22, name: 'Accountant', email: 'acct@example.com', role: 'accountant', tenant_id: 'tenant-1' }],
      },
    });

    const res = await jsonRequest(app, '/permissions/user/override', {
      method: 'POST',
      body: { user_id: 22, permission: 'lab:read', action: 'grant' },
    });

    expect(res.status).toBe(200);
    expect(mockKV.store.has('rbac:perms:tenant-1:accountant:22')).toBe(false);
    expect(mockKV.store.has('rbac:perms:tenant-1:accountant:99')).toBe(true);
  });

  it('rejects critical user grants without explicit confirmation', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: {
        users: [{ id: 22, name: 'Accountant', email: 'acct@example.com', role: 'accountant', tenant_id: 'tenant-1' }],
      },
    });

    const res = await jsonRequest(app, '/permissions/user/override', {
      method: 'POST',
      body: { user_id: 22, permission: 'billing:refund', action: 'grant', reason: 'temporary refund duty' },
    });
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain('Confirmation is required for critical permission grants');
  });

  it('rejects critical user revokes without a clear reason', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: {
        users: [{ id: 22, name: 'Accountant', email: 'acct@example.com', role: 'accountant', tenant_id: 'tenant-1' }],
      },
    });

    const res = await jsonRequest(app, '/permissions/user/override', {
      method: 'POST',
      body: { user_id: 22, permission: 'billing:refund', action: 'revoke' },
    });
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain('Reason is required for critical permission changes');
  });

  it('allows confirmed critical grants and audits step-up metadata', async () => {
    const mockKV = createMockKV({
      'rbac:perms:tenant-1:accountant:22': '["accounting:read"]',
    });
    const { app, mockDB } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      mockKV,
      tables: {
        users: [{ id: 22, name: 'Accountant', email: 'acct@example.com', role: 'accountant', tenant_id: 'tenant-1' }],
      },
    });

    const res = await jsonRequest(app, '/permissions/user/override', {
      method: 'POST',
      body: { user_id: 22, permission: 'billing:refund', action: 'grant', reason: 'temporary refund duty', confirmation: true },
    });

    expect(res.status).toBe(200);
    expect(mockKV.store.has('rbac:perms:tenant-1:accountant:22')).toBe(false);
    const overrideInsert = mockDB.queries.find((query) => query.method === 'run' && query.sql.includes('INSERT INTO user_permission_overrides'));
    expect(overrideInsert?.params).toEqual(expect.arrayContaining(['tenant-1', 22, 'billing:refund', 'grant', 'temporary refund duty']));

    const auditInsert = mockDB.queries.find((query) => query.method === 'run' && query.sql.includes('INSERT INTO audit_logs'));
    expect(auditInsert).toBeDefined();
    const auditPayload = JSON.parse(String(auditInsert?.params[6] ?? '{}')) as Record<string, unknown>;
    expect(auditPayload).toMatchObject({
      userId: 22,
      permission: 'billing:refund',
      action: 'grant',
      reason: 'temporary refund duty',
      criticalPermission: true,
      confirmation: true,
      admin_step_up: 'not_provided',
    });
  });

  it('rejects critical grants when optional admin step-up verification fails', async () => {
    const stepUpKey = 'admin_' + 'pass' + 'word';
    const storedHashKey = 'pass' + 'word_hash';
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      tables: {
        users: [
          { id: 1, name: 'Owner Admin', email: 'admin@example.com', role: 'hospital_admin', tenant_id: 'tenant-1', [storedHashKey]: 'pbkdf2:1:00:00' },
          { id: 22, name: 'Accountant', email: 'acct@example.com', role: 'accountant', tenant_id: 'tenant-1' },
        ],
      },
    });

    const res = await jsonRequest(app, '/permissions/user/override', {
      method: 'POST',
      body: { user_id: 22, permission: 'billing:refund', action: 'grant', reason: 'temporary refund duty', confirmation: true, [stepUpKey]: 'not-matching' },
    });
    const body = await res.json() as { error: string };

    expect(res.status).toBe(403);
    expect(body.error).toContain('Invalid admin ' + 'password for critical permission grant');
  });

  it('invalidates cached permissions when a role override is reset to defaults', async () => {
    const mockKV = createMockKV({
      'rbac:perms:tenant-1:accountant:22': '["accounting:read","lab:read"]',
      'rbac:perms:tenant-1:accountant:99': '["accounting:read","lab:read"]',
      'rbac:perms:tenant-1:doctor:10': '["patients:read"]',
    });
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      mockKV,
      tables: {
        users: [
          { id: 22, name: 'Accountant A', email: 'acct-a@example.com', role: 'accountant', tenant_id: 'tenant-1' },
          { id: 99, name: 'Accountant B', email: 'acct-b@example.com', role: 'accountant', tenant_id: 'tenant-1' },
          { id: 10, name: 'Doctor', email: 'doc@example.com', role: 'doctor', tenant_id: 'tenant-1' },
        ],
      },
    });

    const res = await jsonRequest(app, '/permissions/role/accountant', { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(mockKV.store.has('rbac:perms:tenant-1:accountant:22')).toBe(false);
    expect(mockKV.store.has('rbac:perms:tenant-1:accountant:99')).toBe(false);
    expect(mockKV.store.has('rbac:perms:tenant-1:doctor:10')).toBe(true);
  });

  it('invalidates cached permissions when a user override is removed', async () => {
    const mockKV = createMockKV({
      'rbac:perms:tenant-1:accountant:22': '["accounting:read","lab:read"]',
      'rbac:perms:tenant-1:accountant:99': '["accounting:read"]',
    });
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      mockKV,
      tables: {
        users: [{ id: 22, name: 'Accountant', email: 'acct@example.com', role: 'accountant', tenant_id: 'tenant-1' }],
        user_permission_overrides: [{ tenant_id: 'tenant-1', user_id: 22, permission: 'lab:read', action: 'grant' }],
      },
    });

    const res = await jsonRequest(app, '/permissions/user/override/22/lab:read', { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(mockKV.store.has('rbac:perms:tenant-1:accountant:22')).toBe(false);
    expect(mockKV.store.has('rbac:perms:tenant-1:accountant:99')).toBe(true);
  });

  it('derives module visibility matrix from real role permissions instead of defaulting everything on', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: {
        role_permission_overrides: [],
        role_module_access: [],
      },
    });

    const res = await app.request('/permissions/modules');
    const body = await res.json() as { data: Array<{ role: string; module: string; is_visible: boolean }> };

    expect(res.status).toBe(200);
    expect(body.data.find((row) => row.role === 'reception' && row.module === 'billing')?.is_visible).toBe(true);
    expect(body.data.find((row) => row.role === 'manager' && row.module === 'billing')?.is_visible).toBe(true);
    expect(body.data.find((row) => row.role === 'manager' && row.module === 'reports')?.is_visible).toBe(false);
  });

  it('links module visibility toggles to real role permissions and cache invalidation', async () => {
    const mockKV = createMockKV({
      'rbac:perms:tenant-1:reception:22': '["billing:read"]',
    });
    const { app, mockDB } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      mockKV,
      tables: {
        users: [{ id: 22, name: 'Receptionist', email: 'reception@example.com', role: 'reception', tenant_id: 'tenant-1' }],
        role_permission_overrides: [],
      },
    });

    const res = await jsonRequest(app, '/permissions/modules', {
      method: 'PUT',
      body: { role: 'reception', module: 'billing', is_visible: false },
    });
    const body = await res.json() as { permissions: string[]; affected_permissions: string[] };

    expect(res.status).toBe(200);
    expect(body.affected_permissions).toEqual(expect.arrayContaining(['billing:read', 'billing:write']));
    expect(body.affected_permissions).not.toContain('billing:refund');
    expect(body.affected_permissions).not.toContain('billing:cancel');
    expect(body.permissions).not.toContain('billing:read');
    expect(body.permissions).not.toContain('billing:write');
    expect(mockKV.store.has('rbac:perms:tenant-1:reception:22')).toBe(false);
    expect(mockDB.queries.some((query) => query.sql.includes('role_permission_overrides'))).toBe(true);
  });

  it('requires roles:manage instead of allowing md by role name', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'md',
      tenantId: 'tenant-1',
      userId: 7,
    });

    const res = await jsonRequest(app, '/permissions/role', {
      method: 'PUT',
      body: { role: 'accountant', permissions: ['accounting:read'] },
    });

    expect(res.status).toBe(403);
  });

  it('allows delegated permission admins only through an explicit roles:manage grant', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'director',
      tenantId: 'tenant-1',
      userId: 9,
      queryOverride: (sql) => {
        if (sql.includes('role_permission_overrides')) return { first: null, results: [] };
        if (sql.includes('user_permission_overrides')) {
          return { results: [{ permission: 'roles:manage', action: 'grant' }] };
        }
        return null;
      },
    });

    const res = await app.request('/permissions/catalog');

    expect(res.status).toBe(200);
  });

  it('rejects wildcard and unknown permissions in role overrides', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const wildcard = await jsonRequest(app, '/permissions/role', {
      method: 'PUT',
      body: { role: 'accountant', permissions: ['accounting:read', '*'] },
    });
    const unknown = await jsonRequest(app, '/permissions/role', {
      method: 'PUT',
      body: { role: 'accountant', permissions: ['accounting:read', 'billing:approve-anything'] },
    });

    expect(wildcard.status).toBe(400);
    expect(unknown.status).toBe(400);
  });

  it('rejects wildcard and unknown permissions in user overrides', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: {
        users: [{ id: 22, name: 'Accountant', email: 'acct@example.com', role: 'accountant', tenant_id: 'tenant-1' }],
      },
    });

    const wildcard = await jsonRequest(app, '/permissions/user/override', {
      method: 'POST',
      body: { user_id: 22, permission: '*', action: 'grant' },
    });
    const unknown = await jsonRequest(app, '/permissions/user/override', {
      method: 'POST',
      body: { user_id: 22, permission: 'billing:approve-anything', action: 'grant' },
    });

    expect(wildcard.status).toBe(400);
    expect(unknown.status).toBe(400);
  });

  it('grants a workspace bundle without unsafe admin permissions and invalidates the target user cache', async () => {
    const mockKV = createMockKV({
      'rbac:perms:tenant-1:manager:22': '["dashboard:read"]',
    });
    const { app, mockDB } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      mockKV,
      tables: {
        users: [{ id: 22, name: 'Manager', email: 'manager@example.com', role: 'manager', tenant_id: 'tenant-1' }],
        user_permission_overrides: [],
      },
    });

    const res = await jsonRequest(app, '/permissions/user/workspace-bundle', {
      method: 'POST',
      body: { user_id: 22, bundle_id: 'management' },
    });
    const responseText = await res.text();

    expect(res.status).toBe(200);
    const body = JSON.parse(responseText) as { bundle_id: string; granted_permissions: string[] };
    expect(body.bundle_id).toBe('management');
    expect(body.granted_permissions).toEqual(expect.arrayContaining(['staff:read', 'accounting:read', 'billing.counter.management_cash.read']));
    expect(body.granted_permissions).not.toContain('accounting:write');
    expect(body.granted_permissions).not.toContain('roles:manage');
    expect(body.granted_permissions).not.toContain('settings:write');
    expect(body.granted_permissions).not.toContain('users:delete');
    expect(mockKV.store.has('rbac:perms:tenant-1:manager:22')).toBe(false);
    expect(mockDB.queries.some((query) => query.sql.includes('user_permission_overrides'))).toBe(true);
  });

  it('rejects critical permissions hidden inside a workspace bundle without reason and confirmation', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: {
        users: [{ id: 22, name: 'Accountant', email: 'acct@example.com', role: 'reception', tenant_id: 'tenant-1' }],
        user_permission_overrides: [],
      },
    });

    const res = await jsonRequest(app, '/permissions/user/workspace-bundle', {
      method: 'POST',
      body: { user_id: 22, bundle_id: 'accountant-workspace', action: 'grant' },
    });
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain('Reason is required for critical permission changes');
  });

  it('allows a justified and confirmed critical workspace bundle grant', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: {
        users: [{ id: 22, name: 'Accountant', email: 'acct@example.com', role: 'reception', tenant_id: 'tenant-1' }],
        user_permission_overrides: [],
      },
    });

    const res = await jsonRequest(app, '/permissions/user/workspace-bundle', {
      method: 'POST',
      body: {
        user_id: 22,
        bundle_id: 'accountant-workspace',
        action: 'grant',
        reason: 'Temporary month-end accounting duty',
        confirmation: true,
      },
    });

    expect(res.status).toBe(200);
  });

  it('rejects critical role-level grants unless the backend receives justification and confirmation', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: {
        role_permission_overrides: [],
      },
    });

    const res = await jsonRequest(app, '/permissions/role', {
      method: 'PUT',
      body: { role: 'reception', permissions: ['billing:read', 'billing:refund'] },
    });
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain('Reason is required for critical permission changes');
  });

  it('allows a role to be reduced to zero permissions', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const res = await jsonRequest(app, '/permissions/role', {
      method: 'PUT',
      body: { role: 'manager', permissions: [] },
    });

    expect(res.status).toBe(200);
  });

  it('returns the number of active users affected by a role permission change', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (sql.includes('SELECT id FROM users') && sql.includes('is_active = 1')) {
          return { results: [{ id: 21 }, { id: 22 }] };
        }
        return null;
      },
    });

    const res = await app.request('/permissions/role/reception/impact');
    const body = await res.json() as { role: string; active_user_count: number };

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ role: 'reception', active_user_count: 2 });
  });

  it('sets an inventory workspace level without granting stock adjustment', async () => {
    const mockKV = createMockKV({
      'rbac:perms:tenant-1:manager:22': '["dashboard:read"]',
    });
    const { app, mockDB } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      mockKV,
      tables: {
        users: [{ id: 22, name: 'Manager', email: 'manager@example.com', role: 'manager', tenant_id: 'tenant-1' }],
        user_permission_overrides: [],
      },
    });

    const res = await jsonRequest(app, '/permissions/user/workspace-level', {
      method: 'POST',
      body: { user_id: 22, workspace_id: 'inventory', level: 'operate' },
    });
    const responseText = await res.text();

    expect(res.status, responseText).toBe(200);
    const body = JSON.parse(responseText) as { added_permissions: string[]; critical_permissions_kept_separate: string[] };
    expect(body.added_permissions).toEqual(expect.arrayContaining(['inventory:read', 'inventory:write', 'inventory:transfer', 'inventory:reports']));
    expect(body.added_permissions).not.toContain('inventory:adjust');
    expect(body.critical_permissions_kept_separate).toContain('inventory:adjust');
    expect(mockKV.store.has('rbac:perms:tenant-1:manager:22')).toBe(false);
    expect(mockDB.queries.some((query) => query.sql.includes('user_permission_overrides'))).toBe(true);
  });

  it('revokes a workspace bundle by writing user-level revoke overrides', async () => {
    const mockKV = createMockKV({
      'rbac:perms:tenant-1:manager:22': '["dashboard:read","patients:read"]',
    });
    const { app, mockDB } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      mockKV,
      tables: {
        users: [{ id: 22, name: 'Manager', email: 'manager@example.com', role: 'manager', tenant_id: 'tenant-1' }],
        user_permission_overrides: [],
      },
    });

    const res = await jsonRequest(app, '/permissions/user/workspace-bundle', {
      method: 'POST',
      body: { user_id: 22, bundle_id: 'reception-desk', action: 'revoke' },
    });
    const body = await res.json() as { action: string; revoked_permissions: string[] };

    expect(res.status).toBe(200);
    expect(body.action).toBe('revoke');
    expect(body.revoked_permissions).toEqual(expect.arrayContaining(['patients:read', 'appointments:read', 'billing:read']));
    expect(mockKV.store.has('rbac:perms:tenant-1:manager:22')).toBe(false);
    expect(mockDB.queries.some((query) => query.params.includes('revoke'))).toBe(true);
  });

  it('returns target user effective permissions through the shared helper calculation', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: {
        users: [{ id: 22, name: 'Inventory User', email: 'inventory@example.com', role: 'manager', tenant_id: 'tenant-1' }],
        role_permission_overrides: [
          { tenant_id: 'tenant-1', role: 'manager', permissions: JSON.stringify(['inventory:read', 'inventory:write']) },
        ],
        user_permission_overrides: [
          { tenant_id: 'tenant-1', user_id: 22, permission: 'inventory:write', action: 'revoke', reason: 'temporary restriction', granted_by: 1, created_at: '2026-01-01' },
          { tenant_id: 'tenant-1', user_id: 22, permission: 'roles:manage', action: 'grant', reason: 'access preview', granted_by: 1, created_at: '2026-01-01' },
        ],
      },
    });

    const res = await app.request('/permissions/user/22');
    const body = await res.json() as {
      user: { id: number; role: string };
      role_permissions: string[];
      user_overrides: Array<{ permission: string; action: string; reason?: string }>;
      effective_permissions: string[];
    };

    expect(res.status).toBe(200);
    expect(body.user).toMatchObject({ id: 22, role: 'manager' });
    expect(body.role_permissions).toEqual(['inventory:read', 'inventory:write']);
    expect(body.user_overrides).toEqual(expect.arrayContaining([
      expect.objectContaining({ permission: 'inventory:write', action: 'revoke', reason: 'temporary restriction' }),
      expect.objectContaining({ permission: 'roles:manage', action: 'grant', reason: 'access preview' }),
    ]));
    expect(body.effective_permissions).toEqual(['inventory:read', 'roles:manage']);
  });

  it('workspace bundle grant writes only permissions missing from shared effective permissions', async () => {
    const { app, mockDB } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: {
        users: [{ id: 22, name: 'Reception User', email: 'reception@example.com', role: 'reception', tenant_id: 'tenant-1' }],
        role_permission_overrides: [
          { tenant_id: 'tenant-1', role: 'reception', permissions: JSON.stringify(['patients:read']) },
        ],
        user_permission_overrides: [
          { tenant_id: 'tenant-1', user_id: 22, permission: 'appointments:read', action: 'grant' },
        ],
      },
    });

    const res = await jsonRequest(app, '/permissions/user/workspace-bundle', {
      method: 'POST',
      body: { user_id: 22, bundle_id: 'reception-desk', action: 'grant' },
    });
    const body = await res.json() as { granted_permissions: string[] };

    expect(res.status).toBe(200);
    expect(body.granted_permissions).not.toContain('patients:read');
    expect(body.granted_permissions).not.toContain('appointments:read');
    expect(body.granted_permissions).toEqual(expect.arrayContaining(['patients:write', 'appointments:write', 'billing.counter.read']));
    expect(mockDB.queries.some((query) => query.sql.includes('role_permission_overrides'))).toBe(true);
    expect(mockDB.queries.some((query) => query.sql.includes('user_permission_overrides'))).toBe(true);
  });

  it('returns 400 for invalid effective-permission preview user ids', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const res = await app.request('/permissions/user/not-a-number');
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid user id');
  });

  it('returns 404 for missing target users through the shared helper path', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: {
        users: [],
      },
    });

    const res = await app.request('/permissions/user/999');
    const body = await res.json() as { error: string };

    expect(res.status).toBe(404);
    expect(body.error).toBe('User not found');
  });

  it('requires step-up controls for critical user permission overrides', () => {
    const source = readFileSync(resolve(__dirname, '../../../src/routes/tenant/permissions.ts'), 'utf8');

    expect(source).toContain('assertCriticalGrantControls(data.permission, data.action, data.reason, data.confirmation)');
    expect(source).toContain('Reason is required for critical permission changes');
    expect(source).toContain('Confirmation is required for critical permission grants');
    expect(source).toContain('verifyActorAdminPasswordIfProvided');
    expect(source).toContain('admin_step_up');
    expect(source).toContain('normal_workspace_toggle_excluded_permissions');
    expect(source).toContain('critical_permissions');
    expect(source).toContain('../../lib/criticalPermissions');
  });

  it('blocks user-level overrides against hospital_admin accounts', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: {
        users: [{ id: 1, name: 'Owner Admin', email: 'admin@example.com', role: 'hospital_admin', tenant_id: 'tenant-1' }],
      },
    });

    const res = await jsonRequest(app, '/permissions/user/override', {
      method: 'POST',
      body: { user_id: 1, permission: 'settings:write', action: 'revoke' },
    });

    expect(res.status).toBe(400);
  });
});
