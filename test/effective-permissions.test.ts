import { describe, expect, it, vi } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import {
  applyUserPermissionOverrides,
  getEffectivePermissionsForUser,
  normalizeEffectivePermissions,
} from '../src/lib/effectivePermissions';
import type { Env } from '../src/types';

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
  reason?: string | null;
  granted_by?: number | null;
  created_at?: string | null;
};

function buildMockEnv(options: {
  user?: MockUser | null;
  rolePermissions?: string[] | null;
  rawRolePermissions?: string | null;
  userOverrides?: MockPermissionOverride[];
  failQuery?: 'users' | 'role_permission_overrides' | 'user_permission_overrides';
}): Pick<Env, 'DB'> {
  const db = {
    prepare: (sql: string) => ({
      bind: (..._params: unknown[]) => ({
        first: async () => {
          if (sql.includes('FROM users')) {
            if (options.failQuery === 'users') throw new Error('user lookup failed');
            return options.user ?? null;
          }
          if (sql.includes('FROM role_permission_overrides')) {
            if (options.failQuery === 'role_permission_overrides') throw new Error('role override lookup failed');
            if (options.rawRolePermissions !== undefined) return { permissions: options.rawRolePermissions };
            return options.rolePermissions
              ? { permissions: JSON.stringify(options.rolePermissions) }
              : null;
          }
          return null;
        },
        all: async () => {
          if (sql.includes('FROM user_permission_overrides')) {
            if (options.failQuery === 'user_permission_overrides') throw new Error('user override lookup failed');
            return { results: options.userOverrides ?? [] };
          }
          return { results: [] };
        },
      }),
    }),
  } as unknown as D1Database;

  return { DB: db };
}

async function expectHttpException(promise: Promise<unknown>, status: number, message: string) {
  await expect(promise).rejects.toMatchObject({ status });
  await expect(promise).rejects.toBeInstanceOf(HTTPException);
  await expect(promise).rejects.toMatchObject({ message });
}

describe('effective permission helpers', () => {
  it('normalizes duplicate permissions while preserving wildcard semantics', () => {
    expect(normalizeEffectivePermissions(['inventory:read', 'inventory:read', 'roles:manage'])).toEqual([
      'inventory:read',
      'roles:manage',
    ]);
    expect(normalizeEffectivePermissions(['inventory:read', '*', 'roles:manage'])).toEqual(['*']);
  });

  it('applies user grants and revokes on top of role permissions', () => {
    expect(applyUserPermissionOverrides(
      ['inventory:read', 'inventory:write'],
      [
        { permission: 'inventory:write', action: 'revoke' },
        { permission: 'roles:manage', action: 'grant' },
      ],
    )).toEqual(['inventory:read', 'roles:manage']);
  });

  it('loads user, role override permissions, user overrides and effective permissions together', async () => {
    const result = await getEffectivePermissionsForUser(buildMockEnv({
      user: {
        id: 10,
        name: 'Inventory Manager',
        email: 'inventory@example.com',
        role: 'manager',
        tenant_id: 'tenant-1',
      },
      rolePermissions: ['inventory:read', 'inventory:write'],
      userOverrides: [
        { permission: 'inventory:write', action: 'revoke', reason: 'temporary restriction' },
        { permission: 'roles:manage', action: 'grant', reason: 'access control preview' },
      ],
    }), 'tenant-1', 10);

    expect(result.user).toMatchObject({ id: 10, role: 'manager', tenant_id: 'tenant-1' });
    expect(result.rolePermissions).toEqual(['inventory:read', 'inventory:write']);
    expect(result.userOverrides).toHaveLength(2);
    expect(result.effectivePermissions).toEqual(['inventory:read', 'roles:manage']);
  });

  it('falls back to static role permissions when no tenant role override exists', async () => {
    const result = await getEffectivePermissionsForUser(buildMockEnv({
      user: {
        id: 11,
        name: 'Reception User',
        email: 'reception@example.com',
        role: 'reception',
        tenant_id: 'tenant-1',
      },
      rolePermissions: null,
    }), 'tenant-1', 11);

    expect(result.user.role).toBe('reception');
    expect(result.rolePermissions.length).toBeGreaterThan(0);
    expect(result.effectivePermissions.length).toBeGreaterThan(0);
  });

  it('keeps hospital admin effective permissions as wildcard even with stale overrides', async () => {
    const result = await getEffectivePermissionsForUser(buildMockEnv({
      user: {
        id: 1,
        name: 'Admin User',
        email: 'admin@example.com',
        role: 'hospital_admin',
        tenant_id: 'tenant-1',
      },
      rolePermissions: ['dashboard:read'],
      userOverrides: [{ permission: '*', action: 'revoke', reason: 'stale bad override' }],
    }), 'tenant-1', 1);

    expect(result.rolePermissions).toEqual(['*']);
    expect(result.userOverrides).toEqual([]);
    expect(result.effectivePermissions).toEqual(['*']);
  });

  it('supports custom not-found messages for current-user endpoints', async () => {
    await expectHttpException(
      getEffectivePermissionsForUser(
        buildMockEnv({ user: null }),
        'tenant-1',
        999,
        { notFoundMessage: 'Current user not found' },
      ),
      404,
      'Current user not found',
    );
  });

  it('fails closed when role override JSON is invalid', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expectHttpException(
        getEffectivePermissionsForUser(buildMockEnv({
          user: {
            id: 10,
            name: 'Broken Role User',
            email: 'broken@example.com',
            role: 'manager',
            tenant_id: 'tenant-1',
          },
          rawRolePermissions: '{not-json',
        }), 'tenant-1', 10),
        503,
        'Permission service unavailable',
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('fails closed when any permission lookup query fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user: MockUser = {
      id: 10,
      name: 'Failure User',
      email: 'failure@example.com',
      role: 'manager',
      tenant_id: 'tenant-1',
    };

    try {
      await expectHttpException(
        getEffectivePermissionsForUser(buildMockEnv({ user, failQuery: 'users' }), 'tenant-1', 10),
        503,
        'Permission service unavailable',
      );
      await expectHttpException(
        getEffectivePermissionsForUser(buildMockEnv({ user, failQuery: 'role_permission_overrides' }), 'tenant-1', 10),
        503,
        'Permission service unavailable',
      );
      await expectHttpException(
        getEffectivePermissionsForUser(buildMockEnv({ user, failQuery: 'user_permission_overrides' }), 'tenant-1', 10),
        503,
        'Permission service unavailable',
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
