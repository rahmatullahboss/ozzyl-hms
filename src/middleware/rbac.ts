import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../types';
import { isRoleAllowed, getPermissionsForRole, normalizeRole } from '../lib/authz';
import { getDb } from '../db';

type AppEnv = { Bindings: Env; Variables: Variables };

/**
 * Reusable RBAC middleware — role-based check.
 * Throws 403 if the authenticated user's role is not in the allowed list.
 */
export function requireRole(...roles: string[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const role = c.get('role');
    if (!role || !isRoleAllowed(role, roles)) {
      throw new HTTPException(403, {
        message: `Insufficient permissions. Required roles: ${roles.join(', ')}`,
      });
    }
    await next();
  };
}

const LEGACY_BILLING_COUNTER_WRITE_PERMISSIONS = new Set([
  'billing.counter.activate',
  'billing.counter.close',
  'billing.counter.cash_movement',
  'billing.counter.cash_drop',
  'billing.counter.handover.create',
  'billing.counter.handover.receive',
  'billing.counter.shift.close',
  'billing.counter.shift.handover.create',
  'billing.counter.shift.handover.receive',
  'billing.counter.shift.auto_open',
  'billing.counter.bank_deposit.create',
  'billing.counter.invoice.create',
  'billing.counter.invoice.discount',
]);

const MANAGEMENT_CASH_WRITE_PERMISSIONS = new Set([
  'billing.counter.management_cash.receive',
  'billing.counter.management_cash.partial_collect',
  'billing.counter.management_cash.dispute',
]);

const SENSITIVE_BILLING_COUNTER_PERMISSIONS = new Set([
  'billing.counter.force_close',
  'billing.counter.takeover',
  'billing.counter.bank_deposit.approve',
  'billing.counter.discount.approve',
  'billing.counter.variance.approve',
]);

function hasEffectivePermission(userPermissions: string[], requiredPermission: string): boolean {
  if (userPermissions.includes('*') || userPermissions.includes(requiredPermission)) return true;

  // Backward compatibility for the billing counter hardening rollout.
  // Keep legacy billing:read/write working for normal cashier operations, but
  // do not let generic billing:write unlock supervisor actions such as
  // takeover, force-close, bank-deposit approval, or variance approval.
  if (requiredPermission === 'billing.counter.read' || requiredPermission === 'billing.counter.shift.read') {
    return userPermissions.includes('billing:read') || userPermissions.includes('billing:write');
  }

  if (requiredPermission === 'billing.counter.management_cash.read') {
    return userPermissions.includes('accounting:read')
      || userPermissions.includes('accounting:write')
      || userPermissions.includes('billing:read')
      || userPermissions.includes('billing:write');
  }

  if (MANAGEMENT_CASH_WRITE_PERMISSIONS.has(requiredPermission)) {
    return userPermissions.includes('accounting:write') || userPermissions.includes('billing:write');
  }

  if (LEGACY_BILLING_COUNTER_WRITE_PERMISSIONS.has(requiredPermission)) {
    return userPermissions.includes('billing:write');
  }

  if (SENSITIVE_BILLING_COUNTER_PERMISSIONS.has(requiredPermission)) {
    return userPermissions.includes('accounting:write')
      || userPermissions.includes('settings:write')
      || userPermissions.includes('roles:manage');
  }

  return false;
}

/**
 * Fine-grained permission middleware — checks dynamic (DB) + static permissions.
 * Resolves: role_permission_overrides → user_permission_overrides → static defaults.
 *
 * Usage:
 *   app.post('/refund', requirePermission('billing:refund'), handler)
 */
export function requirePermission(...requiredPermissions: string[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const role = c.get('role') as string;
    const userId = c.get('userId') as string;
    const tenantId = c.get('tenantId') as string;

    if (!role) throw new HTTPException(403, { message: 'No role assigned' });

    // hospital_admin and super_admin have wildcard access
    if (role === 'hospital_admin' || role === 'super_admin') {
      await next();
      return;
    }

    const userPermissions = await resolveUserPermissions(c.env.DB, tenantId, role, userId);

    const hasAll = requiredPermissions.every(p => hasEffectivePermission(userPermissions, p));

    if (!hasAll) {
      const missing = requiredPermissions.filter(p => !hasEffectivePermission(userPermissions, p));
      throw new HTTPException(403, {
        message: `Missing permission: ${missing.join(', ')}`,
      });
    }
    await next();
  };
}

/**
 * Resolve effective permissions for a user:
 * 1. Check role_permission_overrides (tenant-specific role config)
 * 2. Fallback to static ROLE_PERMISSIONS
 * 3. Apply user_permission_overrides (grant/revoke)
 */
export async function resolveUserPermissions(
  dbBinding: unknown,
  tenantId: string,
  role: string,
  userId: string,
): Promise<string[]> {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === 'hospital_admin' || normalizedRole === 'super_admin') {
    return ['*'];
  }

  const db = getDb(dbBinding as any);

  // Step 1: Check tenant-level role override
  let basePermissions: string[];
  try {
    const override = await db.$client.prepare(
      'SELECT permissions FROM role_permission_overrides WHERE tenant_id = ? AND role = ?',
    ).bind(tenantId, role).first<{ permissions: string }>();

    if (override?.permissions) {
      basePermissions = JSON.parse(override.permissions);
    } else {
      basePermissions = getPermissionsForRole(role);
    }
  } catch (error) {
    // Fail closed: if we can't check permission overrides, reject
    console.error('Permission resolution failed:', error);
    throw new HTTPException(503, { message: 'Permission service unavailable' });
  }

  // Step 2: Apply per-user overrides
  try {
    const { results: userOverrides } = await db.$client.prepare(
      'SELECT permission, action FROM user_permission_overrides WHERE tenant_id = ? AND user_id = ?',
    ).bind(tenantId, userId).all();

    const permSet = new Set(basePermissions);
    for (const row of (userOverrides || []) as any[]) {
      if (row.action === 'grant') permSet.add(row.permission);
      if (row.action === 'revoke') permSet.delete(row.permission);
    }
    return [...permSet];
  } catch (error) {
    // Fail closed: if we can't check permission overrides, reject
    console.error('Permission resolution failed:', error);
    throw new HTTPException(503, { message: 'Permission service unavailable' });
  }
}

// ─── KV-cached permission resolution ─────────────────────────────────────────

const RBAC_CACHE_TTL_SECONDS = 300; // 5 minutes

function buildRbacCacheKey(tenantId: string, role: string, userId: string): string {
  return `rbac:perms:${tenantId}:${role}:${userId}`;
}

/**
 * KV-cached version of resolveUserPermissions.
 * Caches resolved permissions in KV for 5 minutes.
 * Falls back to DB on KV miss or KV failure.
 */
export async function resolveUserPermissionsCached(
  dbBinding: unknown,
  kvBinding: unknown,
  tenantId: string,
  role: string,
  userId: string,
): Promise<string[]> {
  // Admin bypass — wildcard, no need to cache
  if (role === 'hospital_admin' || role === 'super_admin') {
    return ['*'];
  }

  const kv = kvBinding as KVNamespace;
  const cacheKey = buildRbacCacheKey(tenantId, role, userId);

  // Try cache first
  try {
    const cached = await kv.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as string[];
    }
  } catch {
    // KV failure — fall through to DB
    console.warn('RBAC cache read failed, falling back to DB');
  }

  // Cache miss — resolve from DB
  const permissions = await resolveUserPermissions(dbBinding, tenantId, role, userId);

  // Store in cache
  try {
    await kv.put(cacheKey, JSON.stringify(permissions), { expirationTtl: RBAC_CACHE_TTL_SECONDS });
  } catch {
    // KV write failure — not critical, just log
    console.warn('RBAC cache write failed');
  }

  return permissions;
}

/**
 * Invalidate cached permissions for a user.
 * Call this when role_permission_overrides or user_permission_overrides change.
 */
export async function invalidatePermissionCache(
  kvBinding: unknown,
  tenantId: string,
  userId: string,
  role: string,
): Promise<void> {
  const kv = kvBinding as KVNamespace;
  const cacheKey = buildRbacCacheKey(tenantId, role, userId);
  try {
    await kv.delete(cacheKey);
  } catch {
    console.warn('RBAC cache invalidation failed');
  }
}

// ─── Preset role groups ──────────────────────────────────────────────────────

export const CLINICAL_ROLES = ['doctor', 'md', 'nurse', 'pharmacist', 'hospital_admin'] as const;
export const ADMIN_ROLES = ['hospital_admin', 'md'] as const;
export const NURSING_ROLES = ['nurse', 'doctor', 'md', 'hospital_admin'] as const;
export const OPD_ROLES = ['nurse', 'reception', 'doctor', 'hospital_admin'] as const;
export const PRESCRIBING_ROLES = ['doctor', 'md', 'pharmacist', 'hospital_admin'] as const;

// ─── Central RBAC route-permission matrix (P0-02) ────────────────────────────
//
// Re-exported here so route-side consumers (other fix branches) can pull both
// `requirePermission` and the central matrix from a single `middleware/rbac`
// import without depending on the lower-level `lib/route-permissions` path.
export {
  ROUTE_PERMISSION_MATRIX,
  ROUTE_PERMISSIONS,
  getRequiredRoutePermission,
  getRouteActionPermission,
  centralRoutePermission,
} from '../lib/route-permissions';
