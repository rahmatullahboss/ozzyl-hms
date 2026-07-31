import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { invalidatePermissionCache, requirePermission } from '../../middleware/rbac';
import {
  VALID_TENANT_ROLES, TENANT_ROLE_LABELS, ALL_PERMISSIONS,
  PERMISSION_GROUPS, ALL_MODULES, getPermissionsForRole, getPermissionsForModule,
  WORKSPACE_BUNDLES, getWorkspaceBundle, getWorkspaceLevelGroup, getWorkspaceLevelOption,
  getWorkspaceLevelManagedPermissions, getWorkspaceLevelForPermissions,
  isWorkspaceBundleGranted,
  type WorkspaceLevelValue,
} from '../../lib/authz';
import { ROUTE_PERMISSIONS } from '../../lib/route-permissions';
import { createAuditLog } from '../../lib/accounting-helpers';
import { getEffectivePermissionsForUser } from '../../lib/effectivePermissions';
import {
  CRITICAL_PERMISSIONS,
  NORMAL_WORKSPACE_TOGGLE_EXCLUDED_PERMISSIONS,
  getCriticalPermissionReason,
  isCriticalPermission,
  isNormalWorkspaceToggleExcludedPermission,
} from '../../lib/criticalPermissions';
import { verifyPassword } from '../../lib/password';

type PEnv = { Bindings: Env; Variables: Variables };
type PermissionRouteContext = Context<PEnv>;
const permissionRoutes = new Hono<PEnv>();

// Danphe-style RBAC management is permission-gated, not role-name gated.
permissionRoutes.use('/*', requirePermission('roles:manage'));

const ROUTE_PERMISSION_CODES = Object.keys(ROUTE_PERMISSIONS).sort();
const EDITABLE_ALL_PERMISSIONS = [...new Set<string>([...ALL_PERMISSIONS, ...ROUTE_PERMISSION_CODES])].sort();
const NORMAL_WORKSPACE_PERMISSION_GROUPS = Object.fromEntries(
  Object.entries(PERMISSION_GROUPS).map(([key, group]) => [
    key,
    {
      ...group,
      permissions: group.permissions.filter((permission) => !isNormalWorkspaceToggleExcludedPermission(permission)),
    },
  ]),
) as Record<string, { label: string; permissions: string[] }>;
const EDITABLE_PERMISSION_GROUPS = {
  ...NORMAL_WORKSPACE_PERMISSION_GROUPS,
  route_permissions: {
    label: 'Route-level Permissions',
    permissions: ROUTE_PERMISSION_CODES,
  },
};

const VALID_PERMISSION_SET = new Set<string>(EDITABLE_ALL_PERMISSIONS);
const VALID_ROLE_SET = new Set<string>(VALID_TENANT_ROLES as readonly string[]);
const VALID_MODULE_SET = new Set<string>(ALL_MODULES as readonly string[]);


function assertCriticalGrantControls(
  permission: string,
  action: 'grant' | 'revoke',
  reason?: string | null,
  confirmation?: boolean | null,
): void {
  if (!isCriticalPermission(permission)) return;
  if (!reason || reason.trim().length < 5) {
    const reasonText = getCriticalPermissionReason(permission);
    throw new HTTPException(400, { message: `Reason is required for critical permission changes: ${permission}${reasonText ? ` (${reasonText})` : ''}` });
  }
  if (action === 'grant' && confirmation !== true) {
    throw new HTTPException(400, { message: `Confirmation is required for critical permission grants: ${permission}` });
  }
}

async function verifyActorAdminPasswordIfProvided(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  actorUserId: number | string,
  adminPassword?: string | null,
): Promise<'not_provided' | 'password_verified'> {
  const password = adminPassword?.trim();
  if (!password) return 'not_provided';

  const actor = await db.$client.prepare(
    'SELECT password_hash FROM users WHERE id = ? AND tenant_id = ?',
  ).bind(actorUserId, tenantId).first<{ password_hash: string | null }>();
  if (!actor?.password_hash) {
    throw new HTTPException(403, { message: 'Admin password verification is not available for this user' });
  }

  const valid = await verifyPassword(password, actor.password_hash);
  if (!valid) {
    throw new HTTPException(403, { message: 'Invalid admin password for critical permission grant' });
  }
  return 'password_verified';
}


function assertKnownRole(role: string): void {
  if (!VALID_ROLE_SET.has(role)) {
    throw new HTTPException(400, { message: `Invalid role: ${role}` });
  }
}

function assertKnownPermission(permission: string): void {
  if (!VALID_PERMISSION_SET.has(permission)) {
    throw new HTTPException(400, { message: `Invalid permission: ${permission}` });
  }
}

function assertKnownPermissions(permissions: string[]): string[] {
  const uniquePermissions = [...new Set(permissions)];
  for (const permission of uniquePermissions) {
    assertKnownPermission(permission);
  }
  return uniquePermissions;
}

function assertKnownModule(module: string): void {
  if (!VALID_MODULE_SET.has(module)) {
    throw new HTTPException(400, { message: `Invalid module: ${module}` });
  }
}

async function getTargetUserRole(db: ReturnType<typeof getDb>, tenantId: string, userId: number | string): Promise<string> {
  const user = await db.$client.prepare(
    'SELECT id, role FROM users WHERE id = ? AND tenant_id = ?',
  ).bind(userId, tenantId).first<{ id: number; role: string }>();
  if (!user) {
    throw new HTTPException(404, { message: 'User not found' });
  }
  return user.role;
}

function assertMutableUserRole(role: string): void {
  if (role === 'hospital_admin' || role === 'super_admin') {
    throw new HTTPException(400, { message: 'Cannot modify hospital_admin permissions' });
  }
}

function auditRequestMeta(c: PermissionRouteContext) {
  const ipAddress = c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for') ?? undefined;
  const userAgent = c.req.header('user-agent') ?? undefined;
  return {
    ipAddress,
    userAgent,
    timestamp: new Date().toISOString(),
    device: {
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    },
  };
}

function parsePermissionJson(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((permission): permission is string => typeof permission === 'string') : [];
  } catch {
    return [];
  }
}

function permissionDiff(before: string[], after: string[]) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = after.filter((permission) => !beforeSet.has(permission)).sort();
  const removed = before.filter((permission) => !afterSet.has(permission)).sort();
  const criticalPermissionsChanged = [...added, ...removed].filter(isCriticalPermission).sort();
  return { added, removed, criticalPermissionsChanged };
}

function getAssignableWorkspaceBundlePermissions(bundle: { id: string; permissions: readonly string[] }): string[] {
  // Broad convenience presets must stay least-privilege. Critical actions are
  // assigned explicitly through a critical bundle or individual permission.
  if (bundle.id === 'management') {
    return bundle.permissions.filter((permission) => !isCriticalPermission(permission));
  }
  return [...bundle.permissions];
}

async function getRolePermissionSnapshot(db: ReturnType<typeof getDb>, tenantId: string, role: string) {
  const row = await db.$client.prepare(
    'SELECT permissions FROM role_permission_overrides WHERE tenant_id = ? AND role = ?',
  ).bind(tenantId, role).first<{ permissions: string }>().catch(() => null);
  return {
    permissions: row?.permissions ? parsePermissionJson(row.permissions) : getPermissionsForRole(role),
    source: row?.permissions ? 'override' : 'default',
  };
}

async function getUserPermissionOverrideSnapshot(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  userId: number,
  permission: string,
) {
  return db.$client.prepare(`
    SELECT permission, action, reason, granted_by, created_at
    FROM user_permission_overrides
    WHERE tenant_id = ? AND user_id = ? AND permission = ?
  `).bind(tenantId, userId, permission).first<{
    permission: string;
    action: 'grant' | 'revoke';
    reason?: string | null;
    granted_by?: string | number | null;
    created_at?: string | null;
  }>().catch(() => null);
}

async function recordAccessAuditLog(
  c: PermissionRouteContext,
  input: {
    tenantId: string;
    actorUserId: string;
    targetType: 'role' | 'user' | 'module';
    targetId: string | number;
    eventType: string;
    tableName: string;
    recordId?: number;
    whatChanged: Record<string, unknown>;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    reason?: string | null;
    criticalPermissionsChanged?: string[];
  },
): Promise<void> {
  const { ipAddress, userAgent, timestamp, device } = auditRequestMeta(c);
  await createAuditLog(
    c.env,
    input.tenantId,
    input.actorUserId,
    'ROLE_CHANGE',
    input.tableName,
    input.recordId ?? 0,
    input.before ? {
      auditEventType: input.eventType,
      timestamp,
      device,
      whoseAccessChanged: { type: input.targetType, id: input.targetId },
      before: input.before,
    } : null,
    input.after ? {
      auditEventType: input.eventType,
      whoChanged: input.actorUserId,
      timestamp,
      device,
      whoseAccessChanged: { type: input.targetType, id: input.targetId },
      whatChanged: input.whatChanged,
      ...input.whatChanged,
      before: input.before,
      after: input.after,
      reason: input.reason ?? null,
      criticalPermissionChange: Boolean(input.criticalPermissionsChanged?.length),
      criticalPermissionsChanged: input.criticalPermissionsChanged ?? [],
    } : null,
    ipAddress,
    userAgent,
  );
}

async function invalidateRolePermissionCaches(kv: KVNamespace | undefined, tenantId: string, role: string): Promise<void> {
  if (!kv) return;
  const prefix = `rbac:perms:${tenantId}:${role}:`;
  try {
    let cursor: string | undefined;
    do {
      const page = await kv.list({ prefix, cursor });
      for (const key of page.keys ?? []) {
        if (key.name.startsWith(prefix)) {
          await kv.delete(key.name);
        }
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  } catch (error) {
    console.warn('RBAC role cache invalidation failed', error);
  }
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const updateRolePermissionsSchema = z.object({
  role: z.string().min(1),
  permissions: z.array(z.string()),
  reason: z.string().optional(),
  confirmation: z.boolean().optional(),
  admin_password: z.string().optional(),
  adminPassword: z.string().optional(),
});

const userPermissionOverrideSchema = z.object({
  user_id: z.number().int().positive(),
  permission: z.string().min(1),
  action: z.enum(['grant', 'revoke']),
  reason: z.string().optional(),
  confirmation: z.boolean().optional(),
  admin_password: z.string().optional(),
  adminPassword: z.string().optional(),
});

const userWorkspaceBundleSchema = z.object({
  user_id: z.number().int().positive(),
  bundle_id: z.string().min(1),
  action: z.enum(['grant', 'revoke']).default('grant'),
  reason: z.string().optional(),
  confirmation: z.boolean().optional(),
  admin_password: z.string().optional(),
  adminPassword: z.string().optional(),
});

const userWorkspaceLevelSchema = z.object({
  user_id: z.number().int().positive(),
  workspace_id: z.string().min(1),
  level: z.enum(['off', 'view', 'operate', 'approve', 'admin']),
});

const moduleAccessSchema = z.object({
  role: z.string().min(1),
  module: z.string().min(1),
  is_visible: z.boolean(),
});

// ═══════════════════════════════════════════════════════════════════════════
// PERMISSION CATALOG (read-only metadata for admin UI)
// ═══════════════════════════════════════════════════════════════════════════

/** GET /catalog — Full permission catalog with groups */
permissionRoutes.get('/catalog', async (c) => {
  return c.json({
    all_permissions: EDITABLE_ALL_PERMISSIONS,
    groups: EDITABLE_PERMISSION_GROUPS,
    critical_permissions: CRITICAL_PERMISSIONS,
    normal_workspace_toggle_excluded_permissions: NORMAL_WORKSPACE_TOGGLE_EXCLUDED_PERMISSIONS,
    roles: VALID_TENANT_ROLES.map(r => ({ role: r, label: TENANT_ROLE_LABELS[r] })),
    modules: ALL_MODULES,
    workspace_bundles: WORKSPACE_BUNDLES.map((bundle) => ({
      ...bundle,
      permissions: getAssignableWorkspaceBundlePermissions(bundle),
    })),
    workspace_level_groups: [
      getWorkspaceLevelGroup('inventory'),
    ].filter(Boolean),
  });
});

/** GET /matrix — Current permission matrix (static defaults + DB overrides) */
permissionRoutes.get('/matrix', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  // Fetch all role overrides for this tenant
  const { results: overrides } = await db.$client.prepare(
    'SELECT role, permissions FROM role_permission_overrides WHERE tenant_id = ?',
  ).bind(tenantId).all().catch(() => ({ results: [] }));

  const overrideMap = new Map((overrides || []).map((o: any) => [o.role, JSON.parse(o.permissions)]));

  const matrix: Record<string, { role: string; label: string; permissions: string[]; is_customized: boolean }> = {};
  for (const role of VALID_TENANT_ROLES) {
    const dbPerms = overrideMap.get(role);
    matrix[role] = {
      role,
      label: TENANT_ROLE_LABELS[role],
      permissions: dbPerms || getPermissionsForRole(role),
      is_customized: !!dbPerms,
    };
  }

  return c.json({ matrix });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROLE-LEVEL PERMISSION MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/** GET /role/:role/impact — Preview how many active users inherit a role change */
permissionRoutes.get('/role/:role/impact', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const role = c.req.param('role');
  assertKnownRole(role);

  const { results } = await db.$client.prepare(
    'SELECT id FROM users WHERE tenant_id = ? AND role = ? AND is_active = 1',
  ).bind(tenantId, role).all<{ id: number }>();

  return c.json({
    role,
    active_user_count: results?.length ?? 0,
  });
});

/** PUT /role — Set permissions for a role (replaces static defaults for this tenant) */
permissionRoutes.put('/role', zValidator('json', updateRolePermissionsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  assertKnownRole(data.role);
  if (data.role === 'hospital_admin') {
    throw new HTTPException(400, { message: 'Cannot modify hospital_admin permissions' });
  }

  const beforeSnapshot = await getRolePermissionSnapshot(db, tenantId, data.role);
  const permissions = assertKnownPermissions(data.permissions);
  const diff = permissionDiff(beforeSnapshot.permissions, permissions);
  const criticalAddedPermissions = diff.added.filter(isCriticalPermission);
  for (const permission of criticalAddedPermissions) {
    assertCriticalGrantControls(permission, 'grant', data.reason, data.confirmation);
  }
  const adminStepUp = criticalAddedPermissions.length > 0
    ? await verifyActorAdminPasswordIfProvided(db, tenantId, userId, data.admin_password ?? data.adminPassword)
    : 'not_required';
  const permJson = JSON.stringify(permissions);

  await db.$client.prepare(`
    INSERT INTO role_permission_overrides (tenant_id, role, permissions, updated_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(tenant_id, role) DO UPDATE SET permissions = excluded.permissions, updated_by = excluded.updated_by, updated_at = datetime('now', '+6 hours')
  `).bind(tenantId, data.role, permJson, userId).run();

  await invalidateRolePermissionCaches(c.env.KV, tenantId, data.role);
  await recordAccessAuditLog(c, {
    tenantId,
    actorUserId: userId,
    targetType: 'role',
    targetId: data.role,
    eventType: diff.criticalPermissionsChanged.length ? 'critical_role_permission_change' : 'role_permission_change',
    tableName: 'role_permission_overrides',
    whatChanged: {
      role: data.role,
      addedPermissions: diff.added,
      removedPermissions: diff.removed,
      permissionCount: permissions.length,
      criticalAddedPermissions,
      confirmation: data.confirmation === true,
      admin_step_up: adminStepUp,
    },
    before: {
      role: data.role,
      permissions: beforeSnapshot.permissions,
      source: beforeSnapshot.source,
    },
    after: {
      role: data.role,
      permissions,
      source: 'override',
    },
    reason: data.reason?.trim() || 'Role permission override update',
    criticalPermissionsChanged: diff.criticalPermissionsChanged,
  });

  return c.json({ message: `Permissions updated for ${data.role}`, permissions });
});

/** DELETE /role/:role — Reset role to static defaults (remove DB override) */
permissionRoutes.delete('/role/:role', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.req.param('role');

  assertKnownRole(role);
  if (role === 'hospital_admin') {
    throw new HTTPException(400, { message: 'Cannot modify hospital_admin permissions' });
  }

  const beforeSnapshot = await getRolePermissionSnapshot(db, tenantId, role);
  const defaultPermissions = getPermissionsForRole(role);
  const diff = permissionDiff(beforeSnapshot.permissions, defaultPermissions);

  await db.$client.prepare(
    'DELETE FROM role_permission_overrides WHERE tenant_id = ? AND role = ?',
  ).bind(tenantId, role).run();
  await invalidateRolePermissionCaches(c.env.KV, tenantId, role);
  await recordAccessAuditLog(c, {
    tenantId,
    actorUserId: userId,
    targetType: 'role',
    targetId: role,
    eventType: diff.criticalPermissionsChanged.length ? 'critical_role_permission_reset' : 'role_permission_reset',
    tableName: 'role_permission_overrides',
    whatChanged: {
      role,
      resetToDefaults: true,
      addedPermissions: diff.added,
      removedPermissions: diff.removed,
    },
    before: {
      role,
      permissions: beforeSnapshot.permissions,
      source: beforeSnapshot.source,
    },
    after: {
      role,
      permissions: defaultPermissions,
      source: 'default',
    },
    reason: 'Role permission override reset to defaults',
    criticalPermissionsChanged: diff.criticalPermissionsChanged,
  });

  return c.json({ message: `${role} permissions reset to defaults`, permissions: defaultPermissions });
});

// ═══════════════════════════════════════════════════════════════════════════
// ACCESS CONTROL USER LIST
// ═══════════════════════════════════════════════════════════════════════════

/** GET /users/access-summary — roles:manage-gated list for Access Control page */
permissionRoutes.get('/users/access-summary', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client.prepare(`
    SELECT s.id, s.user_id,
           COALESCE(NULLIF(u.name, ''), s.name) AS name,
           COALESCE(NULLIF(u.email, ''), s.email) AS email,
           COALESCE(NULLIF(u.role, ''), s.position) AS role,
           s.position,
           inv.id         AS pending_invitation_id,
           inv.expires_at AS pending_invitation_expires_at,
           inv.role       AS pending_invitation_role,
           CASE
             WHEN inv.id IS NULL THEN NULL
             WHEN inv.accepted_at IS NOT NULL THEN 'accepted'
             WHEN inv.revoked_at  IS NOT NULL THEN 'revoked'
             WHEN inv.expires_at  <= datetime('now') THEN 'expired'
             ELSE 'pending'
           END AS pending_invitation_status
    FROM staff s
    LEFT JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
    LEFT JOIN (
      SELECT staff_id, id, expires_at, accepted_at, revoked_at, role
      FROM invitations
      WHERE tenant_id = ?
        AND staff_id IS NOT NULL
        AND id = (
          SELECT MAX(i2.id) FROM invitations i2
          WHERE i2.tenant_id = invitations.tenant_id
            AND i2.staff_id  = invitations.staff_id
        )
    ) inv ON inv.staff_id = s.id
    WHERE s.tenant_id = ? AND s.status = ?
    ORDER BY s.position, s.name
  `).bind(tenantId, tenantId, 'active').all();

  const staff = await Promise.all((results ?? []).map(async (row: any) => {
    const userId = Number(row.user_id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return {
        ...row,
        effective_permissions_count: 0,
        critical_permissions_count: 0,
        active_workspaces: [],
        access_summary_error: false,
      };
    }

    try {
      const { effectivePermissions } = await getEffectivePermissionsForUser(c.env, tenantId, userId);
      return {
        ...row,
        effective_permissions_count: effectivePermissions.length,
        critical_permissions_count: effectivePermissions.filter(isCriticalPermission).length,
        active_workspaces: WORKSPACE_BUNDLES
          .filter((bundle) => isWorkspaceBundleGranted(bundle, effectivePermissions))
          .map((bundle) => bundle.label),
        access_summary_error: false,
      };
    } catch (error) {
      console.error('Access Control summary calculation failed', {
        tenantId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ...row,
        effective_permissions_count: null,
        critical_permissions_count: null,
        active_workspaces: [],
        access_summary_error: true,
        access_summary_error_message: 'Unable to calculate effective access summary',
      };
    }
  }));

  return c.json({ staff });
});

// ═══════════════════════════════════════════════════════════════════════════
// PER-USER PERMISSION OVERRIDES
// ═══════════════════════════════════════════════════════════════════════════

/** GET /user/:userId — Get effective permissions for a specific user */
permissionRoutes.get('/user/:userId', async (c) => {
  const tenantId = requireTenantId(c);
  const targetUserId = c.req.param('userId');
  const numericTargetUserId = Number(targetUserId);
  if (!Number.isInteger(numericTargetUserId) || numericTargetUserId <= 0) {
    throw new HTTPException(400, { message: 'Invalid user id' });
  }

  const { user, rolePermissions, userOverrides, effectivePermissions } = await getEffectivePermissionsForUser(
    c.env,
    tenantId,
    numericTargetUserId,
  );

  return c.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    role_permissions: rolePermissions,
    user_overrides: userOverrides,
    effective_permissions: effectivePermissions,
  });
});

/** POST /user/override — Grant or revoke a specific permission for a user */
permissionRoutes.post('/user/override', zValidator('json', userPermissionOverrideSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const grantedBy = requireUserId(c);
  const data = c.req.valid('json');
  assertKnownPermission(data.permission);
  assertCriticalGrantControls(data.permission, data.action, data.reason, data.confirmation);
  const targetRole = await getTargetUserRole(db, tenantId, data.user_id);
  assertMutableUserRole(targetRole);
  const isCritical = isCriticalPermission(data.permission);
  const adminStepUp = isCritical && data.action === 'grant'
    ? await verifyActorAdminPasswordIfProvided(db, tenantId, grantedBy, data.admin_password ?? data.adminPassword)
    : 'not_required';
  const cleanReason = data.reason?.trim() || null;
  const beforeOverride = await getUserPermissionOverrideSnapshot(db, tenantId, data.user_id, data.permission);

  await db.$client.prepare(`
    INSERT INTO user_permission_overrides (tenant_id, user_id, permission, action, granted_by, reason)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, user_id, permission) DO UPDATE SET action = excluded.action, granted_by = excluded.granted_by, reason = excluded.reason, created_at = datetime('now', '+6 hours')
  `).bind(tenantId, data.user_id, data.permission, data.action, grantedBy, cleanReason).run();

  await invalidatePermissionCache(c.env.KV, tenantId, String(data.user_id), targetRole);
  await recordAccessAuditLog(c, {
    tenantId,
    actorUserId: grantedBy,
    targetType: 'user',
    targetId: data.user_id,
    eventType: isCritical ? 'critical_permission_change' : `permission_${data.action}`,
    tableName: 'user_permission_overrides',
    recordId: data.user_id,
    whatChanged: {
      userId: data.user_id,
      permission: data.permission,
      action: data.action,
      criticalPermission: isCritical,
      confirmation: isCritical && data.action === 'grant' ? data.confirmation === true : undefined,
      admin_step_up: adminStepUp,
    },
    before: {
      userId: data.user_id,
      permission: data.permission,
      override: beforeOverride,
    },
    after: {
      userId: data.user_id,
      permission: data.permission,
      action: data.action,
      reason: cleanReason,
      grantedBy,
    },
    reason: cleanReason,
    criticalPermissionsChanged: isCritical ? [data.permission] : [],
  });

  return c.json({ message: `Permission ${data.action}ed: ${data.permission} for user ${data.user_id}` });
});

/** POST /user/workspace-bundle — Grant a curated bundle of page/workspace permissions */
permissionRoutes.post('/user/workspace-bundle', zValidator('json', userWorkspaceBundleSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const grantedBy = requireUserId(c);
  const data = c.req.valid('json');
  const bundle = getWorkspaceBundle(data.bundle_id);
  if (!bundle) {
    throw new HTTPException(400, { message: `Invalid workspace bundle: ${data.bundle_id}` });
  }

  const bundlePermissions = getAssignableWorkspaceBundlePermissions(bundle);
  for (const permission of bundlePermissions) {
    assertKnownPermission(permission);
  }

  const { user, effectivePermissions } = await getEffectivePermissionsForUser(
    c.env,
    tenantId,
    data.user_id,
  );
  assertMutableUserRole(user.role);

  const beforePermissions = [...effectivePermissions].sort();
  const effectivePermissionSet = new Set(effectivePermissions);
  const changedPermissions = data.action === 'grant'
    ? bundlePermissions.filter((permission) => !effectivePermissionSet.has(permission))
    : bundlePermissions;
  const afterPermissionSet = new Set(beforePermissions);
  for (const permission of changedPermissions) {
    if (data.action === 'grant') afterPermissionSet.add(permission);
    else afterPermissionSet.delete(permission);
  }
  const afterPermissions = [...afterPermissionSet].sort();
  const diff = permissionDiff(beforePermissions, afterPermissions);
  const criticalChangedPermissions = changedPermissions.filter(isCriticalPermission);
  for (const permission of criticalChangedPermissions) {
    assertCriticalGrantControls(permission, data.action, data.reason, data.confirmation);
  }
  const adminStepUp = data.action === 'grant' && criticalChangedPermissions.length > 0
    ? await verifyActorAdminPasswordIfProvided(db, tenantId, grantedBy, data.admin_password ?? data.adminPassword)
    : 'not_required';
  const reason = data.reason?.trim() || `Workspace bundle: ${bundle.label}`;
  for (const permission of changedPermissions) {
    await db.$client.prepare(`
      INSERT INTO user_permission_overrides (tenant_id, user_id, permission, action, granted_by, reason)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, user_id, permission) DO UPDATE SET action = excluded.action, granted_by = excluded.granted_by, reason = excluded.reason, created_at = datetime('now', '+6 hours')
    `).bind(tenantId, data.user_id, permission, data.action, grantedBy, reason).run();
  }

  await invalidatePermissionCache(c.env.KV, tenantId, String(data.user_id), user.role);
  await recordAccessAuditLog(c, {
    tenantId,
    actorUserId: grantedBy,
    targetType: 'user',
    targetId: data.user_id,
    eventType: diff.criticalPermissionsChanged.length ? 'critical_workspace_bundle_change' : `workspace_bundle_${data.action}`,
    tableName: 'user_permission_overrides',
    recordId: data.user_id,
    whatChanged: {
      userId: data.user_id,
      bundleId: bundle.id,
      bundleLabel: bundle.label,
      action: data.action,
      changedPermissions,
      criticalChangedPermissions,
      confirmation: data.confirmation === true,
      admin_step_up: adminStepUp,
    },
    before: {
      userId: data.user_id,
      effectivePermissions: beforePermissions,
    },
    after: {
      userId: data.user_id,
      effectivePermissions: afterPermissions,
    },
    reason,
    criticalPermissionsChanged: diff.criticalPermissionsChanged,
  });

  return c.json({
    message: `${bundle.label} workspace access ${data.action === 'grant' ? 'granted' : 'revoked'}`,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    bundle_id: bundle.id,
    bundle_label: bundle.label,
    action: data.action,
    granted_permissions: data.action === 'grant' ? changedPermissions : [],
    revoked_permissions: data.action === 'revoke' ? changedPermissions : [],
  });
});

/** POST /user/workspace-level — Set a curated workspace level from Off/View/Operate/Approve/Admin */
permissionRoutes.post('/user/workspace-level', zValidator('json', userWorkspaceLevelSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const actorUserId = requireUserId(c);
  const data = c.req.valid('json');
  const selectedLevel = data.level as WorkspaceLevelValue;
  const group = getWorkspaceLevelGroup(data.workspace_id);
  if (!group) {
    throw new HTTPException(400, { message: `Invalid workspace level group: ${data.workspace_id}` });
  }
  const option = getWorkspaceLevelOption(group, selectedLevel);
  if (!option) {
    throw new HTTPException(400, { message: `Invalid workspace level: ${data.workspace_id}/${data.level}` });
  }
  const managedPermissions = getWorkspaceLevelManagedPermissions(group);
  for (const permission of managedPermissions) assertKnownPermission(permission);
  const { user, effectivePermissions } = await getEffectivePermissionsForUser(c.env, tenantId, data.user_id);
  assertMutableUserRole(user.role);
  const beforePermissions = [...effectivePermissions].sort();
  const previousLevel = getWorkspaceLevelForPermissions(group, effectivePermissions);
  const effectiveSet = new Set(effectivePermissions);
  const targetSet = new Set(option.permissions);
  const addPermissions = [...targetSet].filter((permission) => !effectiveSet.has(permission));
  const dropPermissions = managedPermissions.filter((permission) => !targetSet.has(permission) && effectiveSet.has(permission));
  const afterPermissionSet = new Set(beforePermissions);
  for (const permission of addPermissions) afterPermissionSet.add(permission);
  for (const permission of dropPermissions) afterPermissionSet.delete(permission);
  const afterPermissions = [...afterPermissionSet].sort();
  const diff = permissionDiff(beforePermissions, afterPermissions);
  const reason = `Workspace level: ${group.label} ${option.label}`;
  const changes = [
    ...addPermissions.map((permission) => ({ permission, action: 'grant' as const })),
    ...dropPermissions.map((permission) => ({ permission, action: 'revoke' as const })),
  ];

  for (const change of changes) {
    await db.$client.prepare(`
      INSERT INTO user_permission_overrides (tenant_id, user_id, permission, action, granted_by, reason)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, user_id, permission) DO UPDATE SET action = excluded.action, granted_by = excluded.granted_by, reason = excluded.reason, created_at = datetime('now', '+6 hours')
    `).bind(tenantId, data.user_id, change.permission, change.action, actorUserId, reason).run();
  }

  await invalidatePermissionCache(c.env.KV, tenantId, String(data.user_id), user.role);
  await recordAccessAuditLog(c, {
    tenantId,
    actorUserId,
    targetType: 'user',
    targetId: data.user_id,
    eventType: diff.criticalPermissionsChanged.length ? 'critical_workspace_level_change' : 'workspace_level_change',
    tableName: 'user_permission_overrides',
    recordId: data.user_id,
    whatChanged: {
      userId: data.user_id,
      workspaceId: group.id,
      workspaceLabel: group.label,
      previousLevel: previousLevel.level,
      level: option.level,
      levelLabel: option.label,
      addPermissions,
      dropPermissions,
      criticalPermissionsKeptSeparate: group.criticalPermissions ?? [],
    },
    before: {
      userId: data.user_id,
      workspaceId: group.id,
      level: previousLevel.level,
      effectivePermissions: beforePermissions,
    },
    after: {
      userId: data.user_id,
      workspaceId: group.id,
      level: option.level,
      effectivePermissions: afterPermissions,
    },
    reason,
    criticalPermissionsChanged: diff.criticalPermissionsChanged,
  });

  return c.json({
    message: `${group.label} workspace level set to ${option.label}`,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    workspace_id: group.id,
    previous_level: previousLevel.level,
    level: option.level,
    level_label: option.label,
    added_permissions: addPermissions,
    revoked_permissions: dropPermissions,
    managed_permissions: managedPermissions,
    critical_permissions_kept_separate: group.criticalPermissions ?? [],
  });
});

/** DELETE /user/override/:userId/:permission — Remove a user override (revert to role default) */
permissionRoutes.delete('/user/override/:userId/:permission', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = c.req.param('userId');
  const permission = c.req.param('permission');
  const numericUserId = Number(userId);
  if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
    throw new HTTPException(400, { message: 'Invalid user id' });
  }
  assertKnownPermission(permission);
  const targetRole = await getTargetUserRole(db, tenantId, numericUserId);
  assertMutableUserRole(targetRole);
  const beforeOverride = await getUserPermissionOverrideSnapshot(db, tenantId, numericUserId, permission);

  await db.$client.prepare(
    'DELETE FROM user_permission_overrides WHERE tenant_id = ? AND user_id = ? AND permission = ?',
  ).bind(tenantId, userId, permission).run();
  await invalidatePermissionCache(c.env.KV, tenantId, String(numericUserId), targetRole);
  const actorUserId = requireUserId(c);
  await recordAccessAuditLog(c, {
    tenantId,
    actorUserId,
    targetType: 'user',
    targetId: numericUserId,
    eventType: isCriticalPermission(permission) ? 'critical_permission_override_removed' : 'permission_override_removed',
    tableName: 'user_permission_overrides',
    recordId: numericUserId,
    whatChanged: {
      userId: numericUserId,
      permission,
      removedOverride: true,
    },
    before: {
      userId: numericUserId,
      permission,
      override: beforeOverride,
    },
    after: {
      userId: numericUserId,
      permission,
      override: null,
    },
    reason: 'User permission override removed',
    criticalPermissionsChanged: isCriticalPermission(permission) ? [permission] : [],
  });

  return c.json({ message: 'Override removed' });
});

// ═══════════════════════════════════════════════════════════════════════════
// MODULE VISIBILITY
// ═══════════════════════════════════════════════════════════════════════════

/** GET /modules — Get module visibility settings per role */
permissionRoutes.get('/modules', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results: moduleRows } = await db.$client.prepare(
    'SELECT role, module, is_visible FROM role_module_access WHERE tenant_id = ?',
  ).bind(tenantId).all().catch(() => ({ results: [] }));

  const moduleOverrideMap = new Map(
    ((moduleRows || []) as Array<{ role: string; module: string; is_visible: number | boolean }>).map((row) => [
      `${row.role}:${row.module}`,
      Boolean(row.is_visible),
    ]),
  );

  const { results: roleOverrideRows } = await db.$client.prepare(
    'SELECT role, permissions FROM role_permission_overrides WHERE tenant_id = ?',
  ).bind(tenantId).all().catch(() => ({ results: [] }));
  const roleOverrideMap = new Map(
    ((roleOverrideRows || []) as Array<{ role: string; permissions: string }>).map((row) => [
      row.role,
      JSON.parse(row.permissions) as string[],
    ]),
  );

  const data = VALID_TENANT_ROLES.flatMap((role) => {
    const permissions = roleOverrideMap.get(role) ?? getPermissionsForRole(role);
    const permissionSet = new Set(permissions);
    return (ALL_MODULES as readonly string[]).map((module) => {
      const overrideKey = `${role}:${module}`;
      const modulePermissions = getPermissionsForModule(module);
      const derivedVisibility = permissions.includes('*')
        || modulePermissions.length === 0
        || modulePermissions.some((permission) => permissionSet.has(permission));
      return {
        role,
        module,
        is_visible: moduleOverrideMap.get(overrideKey) ?? derivedVisibility,
      };
    });
  });

  return c.json({ data });
});

/** PUT /modules — Set module visibility for a role */
permissionRoutes.put('/modules', zValidator('json', moduleAccessSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');
  assertKnownRole(data.role);
  assertKnownModule(data.module);
  if (data.role === 'hospital_admin') {
    throw new HTTPException(400, { message: 'Cannot modify hospital_admin permissions' });
  }

  const beforeModuleAccess = await db.$client.prepare(
    'SELECT is_visible FROM role_module_access WHERE tenant_id = ? AND role = ? AND module = ?',
  ).bind(tenantId, data.role, data.module).first<{ is_visible: number | boolean }>().catch(() => null);

  await db.$client.prepare(`
    INSERT INTO role_module_access (tenant_id, role, module, is_visible)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(tenant_id, role, module) DO UPDATE SET is_visible = excluded.is_visible
  `).bind(tenantId, data.role, data.module, data.is_visible ? 1 : 0).run();

  const affectedPermissions = getPermissionsForModule(data.module).filter((permission) => !isCriticalPermission(permission));
  const roleOverride = await db.$client.prepare(
    'SELECT permissions FROM role_permission_overrides WHERE tenant_id = ? AND role = ?',
  ).bind(tenantId, data.role).first<{ permissions: string }>().catch(() => null);
  const currentPermissions = roleOverride?.permissions
    ? parsePermissionJson(roleOverride.permissions)
    : getPermissionsForRole(data.role);
  const nextPermissionSet = new Set(currentPermissions);
  for (const permission of affectedPermissions) {
    if (data.is_visible) nextPermissionSet.add(permission);
    else nextPermissionSet.delete(permission);
  }
  const nextPermissions = [...nextPermissionSet].sort();
  const diff = permissionDiff(currentPermissions, nextPermissions);

  await db.$client.prepare(`
    INSERT INTO role_permission_overrides (tenant_id, role, permissions, updated_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(tenant_id, role) DO UPDATE SET permissions = excluded.permissions, updated_by = excluded.updated_by, updated_at = datetime('now', '+6 hours')
  `).bind(tenantId, data.role, JSON.stringify(nextPermissions), requireUserId(c)).run();

  const { results: affectedUsers } = await db.$client.prepare(
    'SELECT id FROM users WHERE tenant_id = ? AND role = ?',
  ).bind(tenantId, data.role).all().catch(() => ({ results: [] }));
  for (const affectedUser of (affectedUsers || []) as Array<{ id: number | string }>) {
    await invalidatePermissionCache(c.env.KV, tenantId, String(affectedUser.id), data.role);
  }

  const userId = requireUserId(c);
  await recordAccessAuditLog(c, {
    tenantId,
    actorUserId: userId,
    targetType: 'module',
    targetId: `${data.role}:${data.module}`,
    eventType: diff.criticalPermissionsChanged.length ? 'critical_module_access_change' : 'module_access_change',
    tableName: 'role_module_access',
    whatChanged: {
      role: data.role,
      module: data.module,
      isVisible: data.is_visible,
      affectedPermissions,
      addedPermissions: diff.added,
      removedPermissions: diff.removed,
      permissions: nextPermissions,
    },
    before: {
      role: data.role,
      module: data.module,
      isVisible: beforeModuleAccess ? Boolean(beforeModuleAccess.is_visible) : null,
      permissions: currentPermissions,
    },
    after: {
      role: data.role,
      module: data.module,
      isVisible: data.is_visible,
      permissions: nextPermissions,
    },
    reason: `Module visibility ${data.is_visible ? 'enabled' : 'disabled'} for ${data.role}`,
    criticalPermissionsChanged: diff.criticalPermissionsChanged,
  });

  return c.json({
    message: `Module ${data.module} ${data.is_visible ? 'shown' : 'hidden'} for ${data.role}`,
    affected_permissions: affectedPermissions,
    permissions: nextPermissions,
  });
});

/** GET /modules/:role — Get visible modules for a specific role */
permissionRoutes.get('/modules/:role', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const role = c.req.param('role');
  assertKnownRole(role);

  const { results } = await db.$client.prepare(
    'SELECT module, is_visible FROM role_module_access WHERE tenant_id = ? AND role = ?',
  ).bind(tenantId, role).all().catch(() => ({ results: [] }));

  const hiddenModules = new Set((results || []).filter((r: any) => !r.is_visible).map((r: any) => r.module));
  const visibleModules = (ALL_MODULES as readonly string[]).filter(m => !hiddenModules.has(m));

  return c.json({ role, visible_modules: visibleModules, hidden_modules: [...hiddenModules] });
});

export default permissionRoutes;
