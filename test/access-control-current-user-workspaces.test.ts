import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import accessControlRoutes from '../src/routes/tenant/access-control';
import type { Env, Variables } from '../src/types';

type MockUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  tenant_id: string;
};

type MockPermissionOverride = {
  permission: string;
  action: 'grant' | 'revoke';
};

function buildMockKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function buildMockDb(options: {
  user?: MockUser | null;
  rolePermissions?: string[] | null;
  userOverrides?: MockPermissionOverride[];
}): D1Database {
  return {
    prepare: (sql: string) => ({
      bind: (..._params: unknown[]) => ({
        first: async () => {
          if (sql.includes('FROM users')) {
            return options.user ?? null;
          }
          if (sql.includes('FROM role_permission_overrides')) {
            return options.rolePermissions
              ? { permissions: JSON.stringify(options.rolePermissions) }
              : null;
          }
          return null;
        },
        all: async () => {
          if (sql.includes('FROM user_permission_overrides')) {
            return { results: options.userOverrides ?? [] };
          }
          return { results: [] };
        },
      }),
    }),
  } as unknown as D1Database;
}

function buildApp(db: D1Database, context?: { tenantId?: string | null; userId?: string | null; role?: string | null }) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.use('*', async (c, next) => {
    c.env = {
      DB: db,
      KV: buildMockKv(),
    } as unknown as Env;
    if (context?.tenantId !== null) c.set('tenantId', context?.tenantId ?? 'tenant-1');
    if (context?.userId !== null) c.set('userId', context?.userId ?? '10');
    if (context?.role !== null) c.set('role', context?.role ?? 'manager');
    await next();
  });

  app.route('/api/access-control', accessControlRoutes);
  app.onError((err, c) => {
    const status = (err as { status?: number }).status ?? 500;
    return c.json({ error: err.message }, status);
  });

  return app;
}

async function getWorkspaceIds(app: Hono<{ Bindings: Env; Variables: Variables }>): Promise<string[]> {
  const res = await app.request('/api/access-control/current-user/workspaces');
  expect(res.status).toBe(200);
  const body = await res.json() as { workspaces: Array<{ id: string }> };
  return body.workspaces.map((workspace) => workspace.id);
}

describe('GET /api/access-control/current-user/workspaces', () => {
  it('returns allowed workspaces for the current logged-in user without roles:manage', async () => {
    const app = buildApp(buildMockDb({
      user: {
        id: 10,
        name: 'Manager User',
        email: 'manager@example.com',
        role: 'manager',
        tenant_id: 'tenant-1',
      },
      rolePermissions: ['inventory:read'],
    }));

    await expect(getWorkspaceIds(app)).resolves.toEqual(['inventory-dashboard']);
  });

  it('applies user-level grant and revoke overrides before resolving workspaces', async () => {
    const app = buildApp(buildMockDb({
      user: {
        id: 10,
        name: 'Inventory User',
        email: 'inventory@example.com',
        role: 'manager',
        tenant_id: 'tenant-1',
      },
      rolePermissions: ['inventory:read', 'inventory:write'],
      userOverrides: [
        { permission: 'inventory:write', action: 'revoke' },
        { permission: 'roles:manage', action: 'grant' },
      ],
    }));

    await expect(getWorkspaceIds(app)).resolves.toEqual([
      'inventory-dashboard',
      'access-control',
    ]);
  });

  it('returns every workspace when effective permissions include wildcard', async () => {
    const app = buildApp(buildMockDb({
      user: {
        id: 1,
        name: 'Hospital Admin',
        email: 'admin@example.com',
        role: 'hospital_admin',
        tenant_id: 'tenant-1',
      },
    }), { role: 'hospital_admin', userId: '1' });

    const workspaceIds = await getWorkspaceIds(app);

    expect(workspaceIds).toHaveLength(16);
    expect(workspaceIds).toContain('reception-dashboard');
    expect(workspaceIds).toContain('inventory-dashboard');
    expect(workspaceIds).toContain('access-control');
  });

  it('returns serialized workspace metadata and normalized effective permissions', async () => {
    const app = buildApp(buildMockDb({
      user: {
        id: 10,
        name: 'Access User',
        email: 'access@example.com',
        role: 'manager',
        tenant_id: 'tenant-1',
      },
      rolePermissions: ['inventory:read', 'inventory:read', 'roles:manage'],
    }));

    const res = await app.request('/api/access-control/current-user/workspaces');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      user: { id: number; role: string };
      tenant_id: string;
      effective_permissions: string[];
      workspaces: Array<{ id: string; label: string; path: string; required_permissions: string[] }>;
    };

    expect(body.user).toMatchObject({ id: 10, role: 'manager' });
    expect(body.tenant_id).toBe('tenant-1');
    expect(body.effective_permissions).toEqual(['inventory:read', 'roles:manage']);
    expect(body.workspaces).toEqual([
      expect.objectContaining({
        id: 'inventory-dashboard',
        label: 'Inventory Dashboard',
        path: 'inventory/overview',
        required_permissions: ['inventory:read'],
      }),
      expect.objectContaining({
        id: 'access-control',
        label: 'Access Control',
        path: 'permissions',
        required_permissions: ['roles:manage'],
      }),
    ]);
  });

  it('keeps stable workspace order for mixed effective permissions', async () => {
    const app = buildApp(buildMockDb({
      user: {
        id: 10,
        name: 'Mixed Access User',
        email: 'mixed@example.com',
        role: 'manager',
        tenant_id: 'tenant-1',
      },
      rolePermissions: ['roles:manage', 'inventory:write', 'manager.dashboard.read', 'inventory:read'],
    }));

    await expect(getWorkspaceIds(app)).resolves.toEqual([
      'manager-dashboard',
      'inventory-dashboard',
      'inventory-entry',
      'access-control',
    ]);
  });

  it('requires a front-desk counter permission before exposing the reception workspace', async () => {
    const patientReader = buildApp(buildMockDb({
      user: {
        id: 10,
        name: 'Patient Reader',
        email: 'patient-reader@example.com',
        role: 'laboratory',
        tenant_id: 'tenant-1',
      },
      rolePermissions: ['patients:read'],
    }));
    const delegatedFrontDesk = buildApp(buildMockDb({
      user: {
        id: 11,
        name: 'Delegated Front Desk User',
        email: 'frontdesk@example.com',
        role: 'manager',
        tenant_id: 'tenant-1',
      },
      rolePermissions: ['billing.counter.read'],
    }), { userId: '11' });

    await expect(getWorkspaceIds(patientReader)).resolves.toEqual([]);
    await expect(getWorkspaceIds(delegatedFrontDesk)).resolves.toEqual(['reception-dashboard']);
  });

  it('does not expose the lab dashboard to machine-settings-only access', async () => {
    const app = buildApp(buildMockDb({
      user: {
        id: 10,
        name: 'Machine Settings User',
        email: 'machines@example.com',
        role: 'manager',
        tenant_id: 'tenant-1',
      },
      rolePermissions: ['lab_machines:read'],
    }));

    await expect(getWorkspaceIds(app)).resolves.toEqual([]);
  });

  it('exposes accounting dashboard for accounting write access without unrelated cash permissions', async () => {
    const app = buildApp(buildMockDb({
      user: {
        id: 10,
        name: 'Delegated Accountant',
        email: 'accounts@example.com',
        role: 'manager',
        tenant_id: 'tenant-1',
      },
      rolePermissions: ['accounting:write'],
    }));

    await expect(getWorkspaceIds(app)).resolves.toEqual(['accounting-dashboard']);
  });

  it('exposes reports and executive dashboards from their functional permissions', async () => {
    const app = buildApp(buildMockDb({
      user: {
        id: 10,
        name: 'Executive Delegate',
        email: 'executive@example.com',
        role: 'manager',
        tenant_id: 'tenant-1',
      },
      rolePermissions: ['reports:read', 'profit:calculate', 'profit:approve'],
    }));

    await expect(getWorkspaceIds(app)).resolves.toEqual([
      'reports-dashboard',
      'md-dashboard',
      'director-dashboard',
    ]);
  });

  it('uses database user role for permission resolution instead of request role context', async () => {
    const app = buildApp(buildMockDb({
      user: {
        id: 10,
        name: 'Lab User',
        email: 'lab@example.com',
        role: 'laboratory',
        tenant_id: 'tenant-1',
      },
      rolePermissions: ['tests:read'],
    }), { role: 'manager' });

    await expect(getWorkspaceIds(app)).resolves.toEqual(['lab-dashboard']);
  });

  it('hides workspaces when a user override revokes the only matching permission', async () => {
    const app = buildApp(buildMockDb({
      user: {
        id: 10,
        name: 'Revoked User',
        email: 'revoked@example.com',
        role: 'manager',
        tenant_id: 'tenant-1',
      },
      rolePermissions: ['inventory:read'],
      userOverrides: [
        { permission: 'inventory:read', action: 'revoke' },
      ],
    }));

    await expect(getWorkspaceIds(app)).resolves.toEqual([]);
  });

  it('returns 401 when user context is missing', async () => {
    const app = buildApp(buildMockDb({ rolePermissions: ['inventory:read'] }), { userId: null });

    const res = await app.request('/api/access-control/current-user/workspaces');
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('returns 403 when tenant context is missing', async () => {
    const app = buildApp(buildMockDb({ rolePermissions: ['inventory:read'] }), { tenantId: null });

    const res = await app.request('/api/access-control/current-user/workspaces');
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'Tenant context required' });
  });

  it('returns 404 when the current user does not exist in the tenant', async () => {
    const app = buildApp(buildMockDb({ user: null, rolePermissions: ['inventory:read'] }));

    const res = await app.request('/api/access-control/current-user/workspaces');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Current user not found' });
  });
});
