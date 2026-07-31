import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { getDb } from '../db';
import { getPermissionsForRole, normalizeRole } from './authz';

export type EffectivePermissionUser = {
  id: number | string;
  name: string | null;
  email: string | null;
  role: string;
  tenant_id: string | number;
};

export type UserPermissionOverride = {
  permission: string;
  action: 'grant' | 'revoke';
  reason?: string | null;
  granted_by?: number | string | null;
  created_at?: string | null;
};

export type EffectivePermissionsResult = {
  user: EffectivePermissionUser;
  rolePermissions: string[];
  userOverrides: UserPermissionOverride[];
  effectivePermissions: string[];
};

function parseRolePermissions(rawPermissions: string | null | undefined, role: string): string[] {
  if (!rawPermissions) return getPermissionsForRole(role);

  try {
    const parsed = JSON.parse(rawPermissions);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
      throw new Error('Role permissions must be a string array');
    }
    return parsed;
  } catch (error) {
    console.error('Invalid role permission override JSON:', error);
    throw new HTTPException(503, { message: 'Permission service unavailable' });
  }
}

export function normalizeEffectivePermissions(permissions: readonly string[]): string[] {
  if (permissions.includes('*')) return ['*'];
  return Array.from(new Set(permissions)).sort();
}

export function applyUserPermissionOverrides(
  rolePermissions: readonly string[],
  userOverrides: readonly Pick<UserPermissionOverride, 'permission' | 'action'>[],
): string[] {
  const permissionSet = new Set(rolePermissions);

  for (const override of userOverrides) {
    if (override.action === 'grant') permissionSet.add(override.permission);
    if (override.action === 'revoke') permissionSet.delete(override.permission);
  }

  return normalizeEffectivePermissions(Array.from(permissionSet));
}

export async function getEffectivePermissionsForUser(
  env: Pick<Env, 'DB'>,
  tenantId: string,
  userId: number | string,
  options: { notFoundMessage?: string } = {},
): Promise<EffectivePermissionsResult> {
  const db = getDb(env.DB);

  let user: EffectivePermissionUser | null;
  let roleOverride: { permissions: string } | null;
  let userOverridesResult: { results?: UserPermissionOverride[] };

  try {
    user = await db.$client.prepare(`
      SELECT id, name, email, role, tenant_id
      FROM users
      WHERE id = ? AND tenant_id = ?
    `).bind(userId, tenantId).first<EffectivePermissionUser>();
  } catch (error) {
    console.error('Effective permission user lookup failed:', error);
    throw new HTTPException(503, { message: 'Permission service unavailable' });
  }

  if (!user) {
    throw new HTTPException(404, { message: options.notFoundMessage ?? 'User not found' });
  }

  const normalizedRole = normalizeRole(user.role);
  if (normalizedRole === 'hospital_admin' || normalizedRole === 'super_admin') {
    return {
      user,
      rolePermissions: ['*'],
      userOverrides: [],
      effectivePermissions: ['*'],
    };
  }

  try {
    roleOverride = await db.$client.prepare(
      'SELECT permissions FROM role_permission_overrides WHERE tenant_id = ? AND role = ?',
    ).bind(tenantId, user.role).first<{ permissions: string }>();
  } catch (error) {
    console.error('Effective permission role override lookup failed:', error);
    throw new HTTPException(503, { message: 'Permission service unavailable' });
  }

  try {
    userOverridesResult = await db.$client.prepare(
      'SELECT permission, action, reason, granted_by, created_at FROM user_permission_overrides WHERE tenant_id = ? AND user_id = ?',
    ).bind(tenantId, user.id).all<UserPermissionOverride>();
  } catch (error) {
    console.error('Effective permission user override lookup failed:', error);
    throw new HTTPException(503, { message: 'Permission service unavailable' });
  }

  const rolePermissions = parseRolePermissions(roleOverride?.permissions, user.role);
  const userOverrides = userOverridesResult.results ?? [];
  const effectivePermissions = applyUserPermissionOverrides(rolePermissions, userOverrides);

  return {
    user,
    rolePermissions,
    userOverrides,
    effectivePermissions,
  };
}
