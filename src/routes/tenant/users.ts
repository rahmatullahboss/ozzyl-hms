// src/routes/tenant/users.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { invalidatePermissionCache, requirePermission } from '../../middleware/rbac';
import { hashPassword, verifyPassword } from '../../lib/password';
import { createAuditLog } from '../../lib/accounting-helpers';
import { isStrongPassword } from '../../middleware/security';
import { VALID_TENANT_ROLES, normalizeRole } from '../../lib/authz';
import { normalizeBangladeshMobile } from '../../lib/bangladesh-phone';
import { invalidateCurrentTenantUserState } from '../../lib/user-auth-state';

const userRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Schemas ────────────────────────────────────────────────────────────────

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().trim().refine((value) => value === "" || normalizeBangladeshMobile(value) !== null, {
    message: "Valid BD mobile required: 01XXXXXXXXX",
  }).optional(),
  username: z.string().min(3).optional(),
  department: z.string().optional(),
  is_active: z.number().int().min(0).max(1).optional(),
});

const changeRoleSchema = z.object({
  role: z.enum(VALID_TENANT_ROLES),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8).refine(isStrongPassword, 'Password must contain at least 1 uppercase letter, 1 lowercase letter, and 1 number'),
});

const resetPasswordSchema = z.object({
  new_password: z.string().min(8).refine(isStrongPassword, 'Password must contain at least 1 uppercase letter, 1 lowercase letter, and 1 number'),
});

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).refine(isStrongPassword, 'Password must contain at least 1 uppercase letter, 1 lowercase letter, and 1 number'),
  name: z.string().min(1),
  role: z.enum(VALID_TENANT_ROLES),
  phone: z.string().trim().refine((value) => value === "" || normalizeBangladeshMobile(value) !== null, {
    message: "Valid BD mobile required: 01XXXXXXXXX",
  }).optional(),
  username: z.string().min(3).optional(),
  department: z.string().optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function auditMeta(c: any) {
  return {
    ipAddress: c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for') ?? undefined,
    userAgent: c.req.header('user-agent') ?? undefined,
  };
}

function isMissingColumnError(err: unknown, column?: string): boolean {
  const msg = String((err as { message?: unknown })?.message ?? err);
  if (!/no such column/i.test(msg)) return false;
  return column ? msg.toLowerCase().includes(column.toLowerCase()) : true;
}

function normalizeOptionalMobile(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return normalizeBangladeshMobile(trimmed);
}
function isAllowedProfilePhotoSignature(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === 'image/png') {
    return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (contentType === 'image/webp') {
    return bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  return false;
}

function extensionForProfilePhoto(contentType: string): 'jpg' | 'png' | 'webp' {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  return 'webp';
}

interface ProfilePhotoUpload {
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function isProfilePhotoUpload(value: unknown): value is ProfilePhotoUpload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ProfilePhotoUpload>;
  return typeof candidate.type === 'string'
    && typeof candidate.size === 'number'
    && typeof candidate.arrayBuffer === 'function';
}

// ─── GET /api/users/me — Current user profile ─────────────────────────────
interface MeUser {
  id: number; email: string; name: string; role: string;
  phone?: string; mobile?: string; username?: string; department?: string;
  photo_url?: string; is_active: number; last_login_at?: string; created_at: string;
}

userRoutes.get('/me', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);

  // `photo_url` and `mobile` were added in migration 0346. Some tenants
  // may not have run it yet; fall back to a safe column set if the
  // richer SELECT fails so the profile page never returns 500.
  let user: MeUser | null = null;
  try {
    user = await db.$client.prepare(
      `SELECT id, email, name, role, phone, mobile, username, department, photo_url, is_active, last_login_at, created_at
       FROM users WHERE id = ? AND tenant_id = ?`
    ).bind(userId, tenantId).first<MeUser>();
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (!/no such column/i.test(msg)) throw err;
    // Schema drift — re-run migration 0346. Fall back to the base columns.
    user = await db.$client.prepare(
      `SELECT id, email, name, role, phone, username, department, is_active, last_login_at, created_at
       FROM users WHERE id = ? AND tenant_id = ?`
    ).bind(userId, tenantId).first<MeUser>();
  }

  if (!user) throw new HTTPException(404, { message: 'User not found' });

  // Convert R2 key to serve URL
  const photoUrl = user.photo_url ? '/api/users/me/photo' : null;

  return c.json({ ...user, photo_url: photoUrl });
});

// ─── PUT /api/users/me — Update current user profile ──────────────────────
const updateMeSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  // Backwards-compatible API field: profile UI sends `phone`, but staff
  // mobile-number login reads users.mobile, so persist this value to both.
  phone: z.string().trim().refine((value) => value === "" || normalizeBangladeshMobile(value) !== null, {
    message: "Valid BD mobile required: 01XXXXXXXXX",
  }).optional(),
});

userRoutes.put('/me', zValidator('json', updateMeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const mobile = normalizeOptionalMobile(data.phone);

  let existing: { id: number; name: string; email: string; phone?: string | null; mobile?: string | null } | null = null;
  try {
    existing = await db.$client.prepare(
      `SELECT id, name, email, phone, mobile FROM users WHERE id = ? AND tenant_id = ?`
    ).bind(userId, tenantId).first<{ id: number; name: string; email: string; phone?: string | null; mobile?: string | null }>();
  } catch (err) {
    if (!isMissingColumnError(err, 'mobile')) throw err;
    existing = await db.$client.prepare(
      `SELECT id, name, email, phone FROM users WHERE id = ? AND tenant_id = ?`
    ).bind(userId, tenantId).first<{ id: number; name: string; email: string; phone?: string | null; mobile?: string | null }>();
  }

  if (!existing) throw new HTTPException(404, { message: 'User not found' });

  // Check duplicate email if changing
  if (data.email && data.email !== existing.email) {
    const emailExists = await db.$client.prepare(
      'SELECT id FROM users WHERE email = ? AND tenant_id = ? AND id != ?'
    ).bind(data.email, tenantId, userId).first();
    if (emailExists) throw new HTTPException(409, { message: 'Email already in use' });
  }

  // The visible profile number is the login mobile number. Block duplicates
  // within the tenant before persisting it to users.mobile.
  if (mobile) {
    try {
      const mobileExists = await db.$client.prepare(
        'SELECT id FROM users WHERE mobile = ? AND tenant_id = ? AND id != ? AND is_active = 1'
      ).bind(mobile, tenantId, userId).first();
      if (mobileExists) throw new HTTPException(409, { message: 'Mobile number already in use' });
    } catch (err) {
      if (err instanceof HTTPException) throw err;
      if (!isMissingColumnError(err, 'mobile')) throw err;
      throw new HTTPException(503, { message: 'Mobile login storage not initialized — run migration 0346' });
    }
  }

  try {
    await db.$client.prepare(
      `UPDATE users SET
         name = COALESCE(?, name),
         email = COALESCE(?, email),
         phone = COALESCE(?, phone),
         mobile = COALESCE(?, mobile),
         updated_at = datetime('now', '+6 hours')
       WHERE id = ? AND tenant_id = ?`
    ).bind(data.name ?? null, data.email ?? null, mobile ?? null, mobile ?? null, userId, tenantId).run();
  } catch (err) {
    if (!isMissingColumnError(err, 'mobile')) throw err;
    throw new HTTPException(503, { message: 'Mobile login storage not initialized — run migration 0346' });
  }

  const { ipAddress, userAgent } = auditMeta(c);
  await createAuditLog(c.env, tenantId, userId, 'PROFILE_UPDATE', 'users', Number(userId), {
    name: existing.name,
    email: existing.email,
    phone: existing.phone ?? null,
    mobile: existing.mobile ?? null,
  }, {
    name: data.name ?? existing.name,
    email: data.email ?? existing.email,
    phone: mobile ?? existing.phone ?? null,
    mobile: mobile ?? existing.mobile ?? null,
  }, ipAddress, userAgent);

  return c.json({ message: 'Profile updated' });
});

// ─── PUT /api/users/me/password — Change current user password ────────────
userRoutes.put('/me/password', zValidator('json', changePasswordSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { current_password, new_password } = c.req.valid('json');

  const user = await db.$client.prepare(
    'SELECT password_hash FROM users WHERE id = ? AND tenant_id = ?'
  ).bind(userId, tenantId).first<{ password_hash: string }>();

  if (!user) throw new HTTPException(404, { message: 'User not found' });

  const valid = await verifyPassword(current_password, user.password_hash);
  if (!valid) throw new HTTPException(401, { message: 'Current password is incorrect' });

  if (current_password === new_password) {
    throw new HTTPException(400, { message: 'New password must differ from current password' });
  }

  const newHash = await hashPassword(new_password);
  await db.$client.prepare(
    `UPDATE users SET password_hash = ?, password_changed_at = datetime('now', '+6 hours'), updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
  ).bind(newHash, userId, tenantId).run();

  const { ipAddress, userAgent } = auditMeta(c);
  await createAuditLog(c.env, tenantId, userId, 'PASSWORD_CHANGE', 'users', Number(userId), null, null, ipAddress, userAgent);

  return c.json({ message: 'Password changed' });
});

// ─── POST /api/users/me/photo — Upload profile photo ──────────────────────
userRoutes.post('/me/photo', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);

  const formData = await c.req.formData();
  const photoEntry = formData.get('photo');

  if (!isProfilePhotoUpload(photoEntry)) {
    throw new HTTPException(400, { message: 'No photo file provided' });
  }

  const photo = photoEntry;
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(photo.type)) {
    throw new HTTPException(400, { message: 'Invalid image type. Allowed: JPG, PNG, WebP' });
  }

  if (photo.size > 5 * 1024 * 1024) {
    throw new HTTPException(400, { message: 'File too large. Maximum 5MB.' });
  }

  const arrayBuffer = await photo.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer.slice(0, 16));
  if (!isAllowedProfilePhotoSignature(bytes, photo.type)) {
    throw new HTTPException(400, { message: 'Invalid image file signature' });
  }

  if (!c.env.UPLOADS) {
    throw new HTTPException(503, { message: 'Profile photo storage is not configured' });
  }

  const ext = extensionForProfilePhoto(photo.type);
  const r2Key = `profile-photos/${tenantId}/${userId}/${crypto.randomUUID()}.${ext}`;
  const oldPhoto = await db.$client.prepare(
    'SELECT photo_url FROM users WHERE id = ? AND tenant_id = ?'
  ).bind(userId, tenantId).first<{ photo_url?: string }>().catch((err) => {
    if (!isMissingColumnError(err, 'photo_url')) throw err;
    throw new HTTPException(503, { message: 'Profile photo storage not initialized — run migration 0346' });
  });

  await c.env.UPLOADS.put(r2Key, arrayBuffer, {
    httpMetadata: { contentType: photo.type },
    customMetadata: { tenantId, uploadedBy: String(userId), purpose: 'profile-photo' },
  });

  try {
    await db.$client.prepare(
      `UPDATE users SET photo_url = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
    ).bind(r2Key, userId, tenantId).run();
  } catch (err) {
    if (!isMissingColumnError(err, 'photo_url')) throw err;
    await c.env.UPLOADS.delete(r2Key).catch(() => {});
    throw new HTTPException(503, { message: 'Profile photo storage not initialized — run migration 0346' });
  }

  const oldKey = oldPhoto?.photo_url;
  const oldAllowed = oldKey?.startsWith(`profile-photos/${tenantId}/${userId}/`) || oldKey?.startsWith(`profile-photos/${tenantId}/${userId}-`);
  if (oldKey && oldKey !== r2Key && oldAllowed) {
    c.executionCtx?.waitUntil(c.env.UPLOADS.delete(oldKey).catch(() => {}));
  }

  const { ipAddress, userAgent } = auditMeta(c);
  await createAuditLog(c.env, tenantId, userId, 'PROFILE_PHOTO_UPDATE', 'users', Number(userId), null, { photo_changed: true }, ipAddress, userAgent);

  return c.json({ photo_url: '/api/users/me/photo' });
});

// ─── GET /api/users/me/photo — Serve profile photo ────────────────────────
userRoutes.get('/me/photo', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);

  // `photo_url` was added in migration 0346. If a tenant hasn't run it
  // yet, treat the request as "no photo set" rather than 500ing.
  let photoKey: string | undefined;
  try {
    const user = await db.$client.prepare(
      'SELECT photo_url FROM users WHERE id = ? AND tenant_id = ?'
    ).bind(userId, tenantId).first<{ photo_url?: string }>();
    photoKey = user?.photo_url ?? undefined;
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (!/no such column/i.test(msg)) throw err;
    photoKey = undefined;
  }

  if (!photoKey) {
    return c.json({ error: 'No photo set' }, 404);
  }

  const obj = await c.env.UPLOADS.get(photoKey);
  if (!obj) {
    return c.json({ error: 'Photo not found' }, 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType ?? 'image/webp');
  headers.set('Cache-Control', 'private, max-age=3600');

  return new Response(obj.body, { headers });
});

// ─── GET /api/users — List all users in tenant ──────────────────────────────
userRoutes.get('/', requirePermission('users:read'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 50));
  const offset = (page - 1) * limit;
  const search = c.req.query('search') || '';
  const roleFilter = c.req.query('role') || '';
  const statusFilter = c.req.query('status');

  let query = `SELECT id, email, name, role, phone, username, department, is_active, last_login_at, login_attempts, locked_until, created_at, updated_at
               FROM users WHERE tenant_id = ?`;
  const params: (string | number)[] = [tenantId];

  if (search) {
    query += ` AND (name LIKE ? OR email LIKE ? OR phone LIKE ? OR username LIKE ?)`;
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern, searchPattern, searchPattern);
  }

  if (roleFilter) {
    query += ` AND role = ?`;
    params.push(roleFilter);
  }

  if (statusFilter !== undefined && statusFilter !== null && statusFilter !== '') {
    query += ` AND is_active = ?`;
    params.push(Number(statusFilter));
  }

  const countQuery = query.replace(
    /SELECT[\s\S]+? FROM/,
    'SELECT COUNT(*) as total FROM'
  );

  const total = await db.$client.prepare(countQuery).bind(...params).first<{ total: number }>();

  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  return c.json({
    users: results,
    pagination: {
      page,
      limit,
      total: total?.total || 0,
      totalPages: Math.ceil((total?.total || 0) / limit),
    },
  });
});

// ─── GET /api/users/:id — Get single user ───────────────────────────────────
userRoutes.get('/:id', requirePermission('users:read'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  const user = await db.$client.prepare(
    `SELECT id, email, name, role, phone, username, department, is_active, last_login_at, created_at, updated_at
     FROM users WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first();

  if (!user) {
    throw new HTTPException(404, { message: 'User not found' });
  }

  return c.json({ user });
});

// ─── POST /api/users — Create user ──────────────────────────────────────────
userRoutes.post('/', requirePermission('users:write'), zValidator('json', createUserSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const mobile = normalizeOptionalMobile(data.phone);

  // Check duplicate email
  const existing = await db.$client.prepare(
    'SELECT id FROM users WHERE email = ? AND tenant_id = ?'
  ).bind(data.email, tenantId).first();

  if (existing) {
    throw new HTTPException(409, { message: 'User with this email already exists' });
  }

  // Check duplicate username if provided
  if (data.username) {
    const usernameExists = await db.$client.prepare(
      'SELECT id FROM users WHERE username = ? AND tenant_id = ?'
    ).bind(data.username, tenantId).first();

    if (usernameExists) {
      throw new HTTPException(409, { message: 'Username already taken' });
    }
  }

  if (mobile) {
    try {
      const mobileExists = await db.$client.prepare(
        'SELECT id FROM users WHERE mobile = ? AND tenant_id = ? AND is_active = 1'
      ).bind(mobile, tenantId).first();
      if (mobileExists) {
        throw new HTTPException(409, { message: 'Mobile number already in use' });
      }
    } catch (err) {
      if (err instanceof HTTPException) throw err;
      if (!isMissingColumnError(err, 'mobile')) throw err;
      throw new HTTPException(503, { message: 'Mobile login storage not initialized — run migration 0346' });
    }
  }

  const passwordHash = await hashPassword(data.password);

  let result;
  try {
    result = await db.$client.prepare(
      `INSERT INTO users (email, password_hash, name, role, tenant_id, phone, mobile, username, department, is_active, password_changed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', '+6 hours'), datetime('now', '+6 hours'))`
    ).bind(
      data.email, passwordHash, data.name, normalizeRole(data.role), tenantId,
      mobile ?? null, mobile ?? null, data.username ?? null, data.department ?? null
    ).run();
  } catch (err) {
    if (!isMissingColumnError(err, 'mobile')) throw err;
    throw new HTTPException(503, { message: 'Mobile login storage not initialized — run migration 0346' });
  }

  const { ipAddress, userAgent } = auditMeta(c);
  await createAuditLog(c.env, tenantId, userId, 'CREATE', 'users', result.meta.last_row_id as number, null, {
    email: data.email,
    name: data.name,
    role: data.role,
    department: data.department,
  }, ipAddress, userAgent);

  return c.json({
    message: 'User created successfully',
    userId: result.meta.last_row_id,
  }, 201);
});

// ─── PUT /api/users/:id — Update user profile ───────────────────────────────
userRoutes.put('/:id', requirePermission('users:write'), zValidator('json', updateUserSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const actorUserId = requireUserId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');
  const mobile = normalizeOptionalMobile(data.phone);

  const existing = await db.$client.prepare(
    'SELECT * FROM users WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<Record<string, unknown>>();

  if (!existing) {
    throw new HTTPException(404, { message: 'User not found' });
  }

  // Prevent editing super_admin
  if (existing['role'] === 'super_admin') {
    throw new HTTPException(400, { message: 'Cannot modify super_admin user' });
  }

  // Check duplicate email if changing
  if (data.email && data.email !== existing['email']) {
    const emailExists = await db.$client.prepare(
      'SELECT id FROM users WHERE email = ? AND tenant_id = ? AND id != ?'
    ).bind(data.email, tenantId, id).first();
    if (emailExists) {
      throw new HTTPException(409, { message: 'Email already in use' });
    }
  }

  // Check duplicate username if changing
  if (data.username && data.username !== existing['username']) {
    const usernameExists = await db.$client.prepare(
      'SELECT id FROM users WHERE username = ? AND tenant_id = ? AND id != ?'
    ).bind(data.username, tenantId, id).first();
    if (usernameExists) {
      throw new HTTPException(409, { message: 'Username already taken' });
    }
  }

  if (mobile) {
    try {
      const mobileExists = await db.$client.prepare(
        'SELECT id FROM users WHERE mobile = ? AND tenant_id = ? AND id != ? AND is_active = 1'
      ).bind(mobile, tenantId, id).first();
      if (mobileExists) {
        throw new HTTPException(409, { message: 'Mobile number already in use' });
      }
    } catch (err) {
      if (err instanceof HTTPException) throw err;
      if (!isMissingColumnError(err, 'mobile')) throw err;
      throw new HTTPException(503, { message: 'Mobile login storage not initialized — run migration 0346' });
    }
  }

  const oldValue = {
    name: existing['name'],
    email: existing['email'],
    phone: existing['phone'],
    mobile: existing['mobile'],
    username: existing['username'],
    department: existing['department'],
    is_active: existing['is_active'],
  };

  try {
    await db.$client.prepare(
      `UPDATE users SET
         name = COALESCE(?, name),
         email = COALESCE(?, email),
         phone = COALESCE(?, phone),
         mobile = COALESCE(?, mobile),
         username = COALESCE(?, username),
         department = COALESCE(?, department),
         is_active = COALESCE(?, is_active),
         updated_at = datetime('now', '+6 hours')
       WHERE id = ? AND tenant_id = ?`
    ).bind(
      data.name ?? null,
      data.email ?? null,
      mobile ?? null,
      mobile ?? null,
      data.username ?? null,
      data.department ?? null,
      data.is_active ?? null,
      id, tenantId
    ).run();
  } catch (err) {
    if (!isMissingColumnError(err, 'mobile')) throw err;
    throw new HTTPException(503, { message: 'Mobile login storage not initialized — run migration 0346' });
  }

  const newValue = {
    name: data.name ?? existing['name'],
    email: data.email ?? existing['email'],
    phone: mobile ?? existing["phone"],
    mobile: mobile ?? existing["mobile"],
    username: data.username ?? existing['username'],
    department: data.department ?? existing['department'],
    is_active: data.is_active ?? existing['is_active'],
  };

  if (data.is_active !== undefined && Number(data.is_active) !== Number(existing['is_active'])) {
    await invalidateCurrentTenantUserState(c.env.KV, tenantId, String(id));
  }

  const { ipAddress, userAgent } = auditMeta(c);
  await createAuditLog(c.env, tenantId, actorUserId, 'UPDATE', 'users', Number(id), oldValue, newValue, ipAddress, userAgent);

  return c.json({ message: 'User updated' });
});

// ─── DELETE /api/users/:id — Deactivate user (soft delete) ──────────────────
userRoutes.delete('/:id', requirePermission('users:delete'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const actorUserId = requireUserId(c);
  const id = c.req.param('id');

  const existing = await db.$client.prepare(
    'SELECT id, name, email, role FROM users WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ id: number; name: string; email: string; role: string }>();

  if (!existing) {
    throw new HTTPException(404, { message: 'User not found' });
  }

  if (existing.role === 'hospital_admin' || existing.role === 'super_admin') {
    throw new HTTPException(400, { message: 'Cannot deactivate admin users' });
  }

  // Prevent self-deactivation
  if (String(existing.id) === actorUserId) {
    throw new HTTPException(400, { message: 'Cannot deactivate your own account' });
  }

  await db.$client.prepare(
    `UPDATE users SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).run();
  await invalidateCurrentTenantUserState(c.env.KV, tenantId, String(id));

  const { ipAddress, userAgent } = auditMeta(c);
  await createAuditLog(c.env, tenantId, actorUserId, 'UPDATE', 'users', Number(id), { is_active: 1 }, { is_active: 0 }, ipAddress, userAgent);

  return c.json({ message: 'User deactivated' });
});

// ─── PATCH /api/users/:id/role — Change user role ───────────────────────────
userRoutes.patch('/:id/role', requirePermission('roles:manage'), zValidator('json', changeRoleSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const actorUserId = requireUserId(c);
  const id = c.req.param('id');
  const { role } = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id, name, email, role FROM users WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ id: number; name: string; email: string; role: string }>();

  if (!existing) {
    throw new HTTPException(404, { message: 'User not found' });
  }

  if (existing.role === 'super_admin' || existing.role === 'hospital_admin') {
    throw new HTTPException(400, { message: 'Cannot change super_admin or hospital_admin role' });
  }

  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) {
    throw new HTTPException(400, { message: 'Invalid role' });
  }
  if (normalizedRole === 'hospital_admin' || normalizedRole === 'super_admin') {
    throw new HTTPException(400, { message: 'Cannot promote users to hospital_admin or super_admin through tenant role management' });
  }

  await db.$client.prepare(
    `UPDATE users SET role = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
  ).bind(normalizedRole, id, tenantId).run();

  await invalidatePermissionCache(c.env.KV, tenantId, String(existing.id), existing.role);
  await invalidatePermissionCache(c.env.KV, tenantId, String(existing.id), normalizedRole);
  await invalidateCurrentTenantUserState(c.env.KV, tenantId, String(existing.id));

  const { ipAddress, userAgent } = auditMeta(c);
  await createAuditLog(c.env, tenantId, actorUserId, 'ROLE_CHANGE', 'users', Number(id), { role: existing.role }, { role: normalizedRole }, ipAddress, userAgent);

  return c.json({ message: `Role changed to ${normalizedRole}` });
});

// ─── POST /api/users/:id/activate — Reactivate user ─────────────────────────
userRoutes.post('/:id/activate', requirePermission('users:write'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const actorUserId = requireUserId(c);
  const id = c.req.param('id');

  const existing = await db.$client.prepare(
    'SELECT id, name, is_active FROM users WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ id: number; name: string; is_active: number }>();

  if (!existing) {
    throw new HTTPException(404, { message: 'User not found' });
  }

  if (existing.is_active === 1) {
    return c.json({ message: 'User is already active' });
  }

  await db.$client.prepare(
    `UPDATE users SET is_active = 1, login_attempts = 0, locked_until = NULL, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).run();
  await invalidateCurrentTenantUserState(c.env.KV, tenantId, String(id));

  const { ipAddress, userAgent } = auditMeta(c);
  await createAuditLog(c.env, tenantId, actorUserId, 'UPDATE', 'users', Number(id), { is_active: 0 }, { is_active: 1 }, ipAddress, userAgent);

  return c.json({ message: 'User activated' });
});

// ─── POST /api/users/change-password — Change own password ──────────────────
userRoutes.post('/change-password', zValidator('json', changePasswordSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { current_password, new_password } = c.req.valid('json');

  const user = await db.$client.prepare(
    'SELECT id, password_hash FROM users WHERE id = ? AND tenant_id = ?'
  ).bind(userId, tenantId).first<{ id: number; password_hash: string }>();

  if (!user) {
    throw new HTTPException(404, { message: 'User not found' });
  }

  const valid = await verifyPassword(current_password, user.password_hash);
  if (!valid) {
    throw new HTTPException(401, { message: 'Current password is incorrect' });
  }

  if (current_password === new_password) {
    throw new HTTPException(400, { message: 'New password must differ from current password' });
  }

  const newHash = await hashPassword(new_password);
  await db.$client.prepare(
    `UPDATE users SET password_hash = ?, password_changed_at = datetime('now', '+6 hours'), updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
  ).bind(newHash, userId, tenantId).run();

  const { ipAddress, userAgent } = auditMeta(c);
  await createAuditLog(c.env, tenantId, userId, 'PASSWORD_CHANGE', 'users', Number(userId), null, null, ipAddress, userAgent);

  return c.json({ message: 'Password changed successfully' });
});

// ─── POST /api/users/:id/reset-password — Admin resets user password ────────
userRoutes.post('/:id/reset-password', requirePermission('users:write'), zValidator('json', resetPasswordSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const actorUserId = requireUserId(c);
  const id = c.req.param('id');
  const { new_password } = c.req.valid('json');

  const targetUser = await db.$client.prepare(
    'SELECT id, name, email, role FROM users WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ id: number; name: string; email: string; role: string }>();

  if (!targetUser) {
    throw new HTTPException(404, { message: 'User not found' });
  }

  if (targetUser.role === 'super_admin') {
    throw new HTTPException(400, { message: 'Cannot reset super_admin password' });
  }

  const newHash = await hashPassword(new_password);
  await db.$client.prepare(
    `UPDATE users SET password_hash = ?, password_changed_at = datetime('now', '+6 hours'), login_attempts = 0, locked_until = NULL, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
  ).bind(newHash, id, tenantId).run();

  const { ipAddress, userAgent } = auditMeta(c);
  await createAuditLog(c.env, tenantId, actorUserId, 'PASSWORD_CHANGE', 'users', Number(id), null, { reset_by: actorUserId }, ipAddress, userAgent);

  return c.json({ message: `Password reset for ${targetUser.name}` });
});

export default userRoutes;
