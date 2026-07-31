import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { setCookie } from 'hono/cookie';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { generateToken } from '../../middleware/auth';
import type { Env, Variables } from '../../types';
import { getDb } from '../../db';
import { DEFAULT_ROLE_ROUTES, getPermissionsForRole, normalizeRole, PLATFORM_ROLES, VALID_TENANT_ROLES } from '../../lib/authz';
import {
  canManagePlatformRole,
  isPrivilegedPlatformOperator,
  parsePlatformStaffSubjectId,
  platformStaffSubjectId,
  requirePlatformCapability,
} from '../../lib/platform-staff';

const platformStaffRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const createStaffSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
  name: z.string().trim().min(1),
  role: z.enum(PLATFORM_ROLES),
});

const updateStaffSchema = z.object({
  name: z.string().trim().min(1).optional(),
  role: z.enum(PLATFORM_ROLES).optional(),
  is_active: z.number().int().min(0).max(1).optional(),
}).strict();

const resetPasswordSchema = z.object({
  password: z.string().min(8),
});

const grantSchema = z.object({
  tenantId: z.number().int().positive(),
  allowedRole: z.enum(VALID_TENANT_ROLES),
  reason: z.string().trim().min(3).max(500),
  expiresAt: z.string().trim().max(40).optional(),
});

const impersonateSchema = z.object({
  grantId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
  targetUserId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
  reason: z.string().trim().min(3).max(500).optional(),
}).strict().optional();

type PlatformStaffRow = {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  role: string;
  is_active: number;
};

type TenantRow = {
  id: number;
  name: string;
  subdomain: string;
  status: string;
  plan: string;
};

type TenantUserRow = {
  id: number;
  email: string;
  name: string;
  role: string;
  created_at?: string;
};

type PlatformContext = Context<{ Bindings: Env; Variables: Variables }>;

function currentRole(c: PlatformContext): string {
  const role = c.get('role');
  return role ? String(role) : '';
}

function currentUserId(c: PlatformContext): string | null {
  const userId = c.get('userId');
  return userId === undefined || userId === null ? null : String(userId);
}

function setAdminCookie(c: PlatformContext, token: string) {
  setCookie(c, 'admin_token', token, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: c.env.ENVIRONMENT === 'production',
    path: '/',
    maxAge: 8 * 60 * 60,
  });
}

async function findActiveGrant(
  db: ReturnType<typeof getDb>['$client'],
  staffId: number,
  tenantId: number,
  grantId?: number | null,
): Promise<{ allowed_role: string; id: number } | null> {
  if (grantId) {
    return db.prepare(
      `SELECT id, allowed_role
       FROM platform_staff_tenant_grants
       WHERE id = ?
         AND staff_id = ?
         AND tenant_id = ?
         AND grant_type = 'impersonate'
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > datetime('now'))
       LIMIT 1`,
    ).bind(grantId, staffId, tenantId).first<{ id: number; allowed_role: string }>();
  }

  return db.prepare(
    `SELECT id, allowed_role
     FROM platform_staff_tenant_grants
     WHERE staff_id = ?
       AND tenant_id = ?
       AND grant_type = 'impersonate'
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > datetime('now'))
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
  ).bind(staffId, tenantId).first<{ id: number; allowed_role: string }>();
}

async function ensurePlatformSupportUser(
  db: ReturnType<typeof getDb>['$client'],
  tenantId: number,
  tenantSubdomain: string,
  role: string,
): Promise<TenantUserRow | null> {
  const safeSubdomain = tenantSubdomain || `tenant-${tenantId}`;
  const email = `platform-support+${tenantId}+${role}@ozzyl.local`;
  const name = `Ozzyl Support (${role.replace(/_/g, ' ')})`;

  const existing = await db.prepare(
    `SELECT id, email, name, role, created_at
     FROM users
     WHERE tenant_id = ? AND lower(email) = lower(?)
     LIMIT 1`,
  ).bind(tenantId, email).first<TenantUserRow>();
  if (existing) return existing;

  const passwordHash = await bcrypt.hash(`platform-support:${safeSubdomain}:${role}:${Date.now()}`, 10);
  const result = await db.prepare(
    `INSERT INTO users (email, password_hash, name, role, tenant_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  ).bind(email, passwordHash, name, role, tenantId).run();

  const userId = (result.meta?.last_row_id as number | undefined) ?? null;
  if (!userId) return null;

  return {
    id: userId,
    email,
    name,
    role,
  };
}

platformStaffRoutes.post('/login', zValidator('json', loginSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { email, password } = c.req.valid('json');

  const staff = await db.$client.prepare(
    `SELECT id, email, password_hash, name, role, is_active
     FROM platform_staff_accounts
     WHERE lower(email) = lower(?)
     LIMIT 1`,
  ).bind(email).first<PlatformStaffRow>();

  if (!staff || staff.is_active !== 1) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const validPassword = await bcrypt.compare(password, staff.password_hash);
  if (!validPassword) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const role = normalizeRole(staff.role) || staff.role;
  const token = await generateToken({
    userId: platformStaffSubjectId(staff.id),
    role,
    permissions: getPermissionsForRole(role),
  }, c.env.JWT_SECRET, 8);

  await db.$client.prepare(
    `UPDATE platform_staff_accounts
     SET last_login_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
  ).bind(staff.id).run();

  setAdminCookie(c, token);

  return c.json({
    user: {
      id: platformStaffSubjectId(staff.id),
      email: staff.email,
      name: staff.name,
      role,
    },
  });
});

platformStaffRoutes.post('/refresh', async (c) => {
  const db = getDb(c.env.DB);
  const staffId = parsePlatformStaffSubjectId(currentUserId(c));
  const role = normalizeRole(currentRole(c)) || currentRole(c);
  if (!staffId || !role) {
    return c.json({ error: 'Not a platform staff session' }, 403);
  }

  const staff = await db.$client.prepare(
    `SELECT id, email, name, role, is_active
     FROM platform_staff_accounts
     WHERE id = ?
     LIMIT 1`,
  ).bind(staffId).first<Omit<PlatformStaffRow, 'password_hash'>>();

  if (!staff || staff.is_active !== 1 || (normalizeRole(staff.role) || staff.role) !== role) {
    return c.json({ error: 'Session is no longer valid' }, 401);
  }

  return c.json({
    user: {
      id: platformStaffSubjectId(staff.id),
      email: staff.email,
      name: staff.name,
      role,
    },
  });
});

platformStaffRoutes.get('/hospitals', requirePlatformCapability('platform:hospitals:read'), async (c) => {
  const db = getDb(c.env.DB);
  const { results } = await db.$client.prepare(
    `SELECT id, name, subdomain, status, plan
     FROM tenants
     ORDER BY name ASC
     LIMIT 500`,
  ).all();
  return c.json({ hospitals: results });
});

platformStaffRoutes.get('/my-grants', requirePlatformCapability('platform:support:impersonate'), async (c) => {
  const db = getDb(c.env.DB);
  const staffId = parsePlatformStaffSubjectId(currentUserId(c));
  if (!staffId) {
    return c.json({ grants: [] });
  }

  const { results } = await db.$client.prepare(
    `SELECT g.id, g.staff_id, g.tenant_id, t.name as tenant_name, t.subdomain as tenant_subdomain,
            g.grant_type, g.allowed_role, g.reason, g.expires_at, g.revoked_at, g.created_at
     FROM platform_staff_tenant_grants g
     LEFT JOIN tenants t ON t.id = g.tenant_id
     WHERE g.staff_id = ?
     ORDER BY CASE WHEN g.revoked_at IS NULL THEN 0 ELSE 1 END, g.created_at DESC, g.id DESC`,
  ).bind(staffId).all();

  return c.json({ grants: results });
});

platformStaffRoutes.get('/', requirePlatformCapability('platform:staff:manage'), async (c) => {
  const db = getDb(c.env.DB);
  const { results } = await db.$client.prepare(
    `SELECT id, email, name, role, is_active, last_login_at, created_at, updated_at
     FROM platform_staff_accounts
     ORDER BY created_at DESC, id DESC`,
  ).all();
  return c.json({ staff: results });
});

platformStaffRoutes.post('/', requirePlatformCapability('platform:staff:manage'), zValidator('json', createStaffSchema), async (c) => {
  const db = getDb(c.env.DB);
  const actorRole = currentRole(c);
  const data = c.req.valid('json');

  if (!canManagePlatformRole(actorRole, data.role)) {
    return c.json({ error: 'Cannot create this platform role' }, 403);
  }

  const passwordHash = await bcrypt.hash(data.password, 10);
  const result = await db.$client.prepare(
    `INSERT INTO platform_staff_accounts (email, password_hash, name, role, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  ).bind(data.email, passwordHash, data.name, data.role, currentUserId(c), currentUserId(c)).run();

  return c.json({ staffId: result.meta.last_row_id }, 201);
});

platformStaffRoutes.put('/:id', requirePlatformCapability('platform:staff:manage'), zValidator('json', updateStaffSchema), async (c) => {
  const db = getDb(c.env.DB);
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: 'Invalid staff ID' }, 400);
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    `SELECT id, role FROM platform_staff_accounts WHERE id = ? LIMIT 1`,
  ).bind(id).first<{ id: number; role: string }>();
  if (!existing) return c.json({ error: 'Staff account not found' }, 404);

  if (data.role && !canManagePlatformRole(currentRole(c), data.role)) {
    return c.json({ error: 'Cannot assign this platform role' }, 403);
  }
  if (!canManagePlatformRole(currentRole(c), existing.role)) {
    return c.json({ error: 'Cannot modify this platform role' }, 403);
  }

  await db.$client.prepare(
    `UPDATE platform_staff_accounts
     SET name = COALESCE(?, name),
         role = COALESCE(?, role),
         is_active = COALESCE(?, is_active),
         updated_by = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
  ).bind(data.name ?? null, data.role ?? null, data.is_active ?? null, currentUserId(c), id).run();

  return c.json({ message: 'Platform staff updated' });
});

platformStaffRoutes.post('/:id/reset-password', requirePlatformCapability('platform:staff:manage'), zValidator('json', resetPasswordSchema), async (c) => {
  const db = getDb(c.env.DB);
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: 'Invalid staff ID' }, 400);

  const existing = await db.$client.prepare(
    `SELECT id, role FROM platform_staff_accounts WHERE id = ? LIMIT 1`,
  ).bind(id).first<{ id: number; role: string }>();
  if (!existing) return c.json({ error: 'Staff account not found' }, 404);
  if (!canManagePlatformRole(currentRole(c), existing.role)) {
    return c.json({ error: 'Cannot reset this platform role' }, 403);
  }

  const { password } = c.req.valid('json');
  const passwordHash = await bcrypt.hash(password, 10);
  await db.$client.prepare(
    `UPDATE platform_staff_accounts
     SET password_hash = ?, updated_by = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).bind(passwordHash, currentUserId(c), id).run();

  return c.json({ message: 'Password reset' });
});

platformStaffRoutes.get('/:id/grants', requirePlatformCapability('platform:staff:manage'), async (c) => {
  const db = getDb(c.env.DB);
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: 'Invalid staff ID' }, 400);

  const { results } = await db.$client.prepare(
    `SELECT g.id, g.staff_id, g.tenant_id, t.name as tenant_name, t.subdomain as tenant_subdomain,
            g.grant_type, g.allowed_role, g.reason, g.expires_at, g.revoked_at, g.created_at
     FROM platform_staff_tenant_grants g
     LEFT JOIN tenants t ON t.id = g.tenant_id
     WHERE g.staff_id = ?
     ORDER BY CASE WHEN g.revoked_at IS NULL THEN 0 ELSE 1 END, g.created_at DESC, g.id DESC`,
  ).bind(id).all();

  return c.json({ grants: results });
});

platformStaffRoutes.post('/:id/grants', requirePlatformCapability('platform:staff:manage'), zValidator('json', grantSchema), async (c) => {
  const db = getDb(c.env.DB);
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: 'Invalid staff ID' }, 400);
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    `SELECT id, role FROM platform_staff_accounts WHERE id = ? AND is_active = 1 LIMIT 1`,
  ).bind(id).first<{ id: number; role: string }>();
  if (!existing) return c.json({ error: 'Staff account not found' }, 404);
  if (!canManagePlatformRole(currentRole(c), existing.role)) {
    return c.json({ error: 'Cannot grant access to this platform role' }, 403);
  }

  const tenant = await db.$client.prepare(
    `SELECT id FROM tenants WHERE id = ? LIMIT 1`,
  ).bind(data.tenantId).first<{ id: number }>();
  if (!tenant) return c.json({ error: 'Hospital not found' }, 404);

  const result = await db.$client.prepare(
    `INSERT INTO platform_staff_tenant_grants
       (staff_id, tenant_id, grant_type, allowed_role, reason, expires_at, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, 'impersonate', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  ).bind(
    id,
    data.tenantId,
    data.allowedRole,
    data.reason,
    data.expiresAt ?? null,
    currentUserId(c),
    currentUserId(c),
  ).run();

  return c.json({ grantId: result.meta.last_row_id }, 201);
});

platformStaffRoutes.delete('/:id/grants/:grantId', requirePlatformCapability('platform:staff:manage'), async (c) => {
  const db = getDb(c.env.DB);
  const id = Number(c.req.param('id'));
  const grantId = Number(c.req.param('grantId'));
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(grantId) || grantId <= 0) {
    return c.json({ error: 'Invalid grant ID' }, 400);
  }

  await db.$client.prepare(
    `UPDATE platform_staff_tenant_grants
     SET revoked_at = datetime('now'), updated_by = ?, updated_at = datetime('now')
     WHERE id = ? AND staff_id = ? AND revoked_at IS NULL`,
  ).bind(currentUserId(c), grantId, id).run();

  return c.json({ message: 'Grant revoked' });
});

platformStaffRoutes.post('/impersonate/:tenantId', requirePlatformCapability('platform:support:impersonate'), zValidator('json', impersonateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = Number(c.req.param('tenantId'));
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) return c.json({ error: 'Invalid tenant ID' }, 400);
  const body = c.req.valid('json') ?? {};
  const role = normalizeRole(currentRole(c)) || currentRole(c);
  const staffId = parsePlatformStaffSubjectId(currentUserId(c));
  const privileged = isPrivilegedPlatformOperator(role);

  const tenant = await db.$client.prepare(
    `SELECT id, name, subdomain, status, plan FROM tenants WHERE id = ? LIMIT 1`,
  ).bind(tenantId).first<TenantRow>();
  if (!tenant) return c.json({ error: 'Hospital not found' }, 404);

  const requestedGrantId = body.grantId === undefined ? null : Number(body.grantId);
  const grant = privileged ? null : (staffId ? await findActiveGrant(db.$client, staffId, tenantId, requestedGrantId) : null);
  if (!privileged && !grant) {
    return c.json({ error: 'No active support grant for this hospital' }, 403);
  }

  const targetUserId = body.targetUserId === undefined ? null : Number(body.targetUserId);
  let targetUser: TenantUserRow | null = null;
  if (targetUserId) {
    targetUser = await db.$client.prepare(
      `SELECT id, email, name, role, created_at
       FROM users
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
    ).bind(tenantId, targetUserId).first<TenantUserRow>();
  } else if (grant?.allowed_role) {
    targetUser = await db.$client.prepare(
      `SELECT id, email, name, role, created_at
       FROM users
       WHERE tenant_id = ? AND role = ?
       ORDER BY id ASC
       LIMIT 1`,
    ).bind(tenantId, grant.allowed_role).first<TenantUserRow>();
  } else {
    targetUser = await db.$client.prepare(
      `SELECT id, email, name, role, created_at
       FROM users
       WHERE tenant_id = ?
       ORDER BY CASE WHEN role = 'hospital_admin' THEN 0 ELSE 1 END, id ASC
       LIMIT 1`,
    ).bind(tenantId).first<TenantUserRow>();
  }

  if (!targetUser && grant?.allowed_role) {
    targetUser = await ensurePlatformSupportUser(db.$client, tenant.id, tenant.subdomain, grant.allowed_role);
  }

  if (!targetUser) return c.json({ error: 'No hospital user exists to impersonate' }, 409);
  const targetRole = normalizeRole(targetUser.role);
  if (!targetRole || targetRole === 'super_admin') {
    return c.json({ error: 'Target user role is not impersonatable' }, 400);
  }
  if (!privileged && grant && targetRole !== grant.allowed_role) {
    return c.json({ error: 'Support grant does not allow this target role' }, 403);
  }

  const targetPermissions = targetRole === 'hospital_admin' ? ['*'] : getPermissionsForRole(targetRole);
  const targetRoute = DEFAULT_ROLE_ROUTES[targetRole] || 'dashboard';
  const reason = body.reason || grant?.allowed_role || 'platform_support';
  const token = await generateToken({
    userId: String(targetUser.id),
    role: targetRole,
    tenantId: String(tenant.id),
    permissions: targetPermissions,
    isImpersonation: true,
    impersonatedByUserId: currentUserId(c) || '0',
    impersonationReason: reason,
    impersonationSessionId: `platform:${tenant.id}:${targetUser.id}:${Date.now()}`,
  }, c.env.JWT_SECRET, 2);

  await db.$client.prepare(
    `INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, created_at)
     VALUES (?, ?, 'impersonate_start', 'users', ?, datetime('now'))`,
  ).bind(tenant.id, staffId ?? null, targetUser.id).run().catch((auditErr) => {
    console.error('platform staff impersonation audit log insert failed:', auditErr);
  });

  return c.json({
    token,
    tenant: {
      id: tenant.id,
      name: tenant.name,
      subdomain: tenant.subdomain,
      status: tenant.status,
      plan: tenant.plan,
    },
    targetUser: {
      id: targetUser.id,
      email: targetUser.email,
      name: targetUser.name,
      role: targetRole,
    },
    redirectUrl: `/h/${tenant.subdomain}/${targetRoute}`,
  });
});

export default platformStaffRoutes;
