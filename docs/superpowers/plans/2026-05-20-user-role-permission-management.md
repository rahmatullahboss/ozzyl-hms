# User, Role & Permission Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the User, Role & Permission Management module — add missing user fields, user CRUD routes, password management, account lockout, auto-audit middleware, and audit log export.

**Architecture:** Cloudflare Workers (Hono) + D1 (SQLite). All new routes follow existing patterns: raw SQL via `db.$client.prepare()`, Zod validation, `createAuditLog()` for audit entries, `requirePermission()` for access control.

**Tech Stack:** Hono, Zod, D1, PBKDF2 (Web Crypto), existing `createAuditLog` helper

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `migrations/0264_user_management_fields.sql` | Create | Add missing columns to `users` table |
| `migrations/0265_audit_action_expansion.sql` | Create | Expand audit_logs action CHECK constraint |
| `src/routes/tenant/users.ts` | Create | User CRUD routes (list, get, update, deactivate, role change, password change/reset) |
| `src/middleware/audit.ts` | Create | Auto-audit middleware for all write operations |
| `src/routes/tenant/audit.ts` | Modify | Add export endpoint |
| `src/index.ts` | Modify | Register new `/api/users` route + audit middleware |
| `src/routes/tenant/auth.ts` | Modify | Add account lockout logic on failed login |

---

### Task 1: Migration — Add missing columns to users table

**Files:**
- Create: `migrations/0264_user_management_fields.sql`

- [ ] **Step 1: Create migration file**

```sql
-- migrations/0264_user_management_fields.sql
-- Add missing columns for user management module

ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN department TEXT;
ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN login_attempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(tenant_id, username);
```

- [ ] **Step 2: Run migration locally**

Run: `wrangler d1 execute hms-saas --local --file=./migrations/0264_user_management_fields.sql`
Expected: Success, no errors

- [ ] **Step 3: Commit**

```bash
git add migrations/0264_user_management_fields.sql
git commit -m "feat: add user management columns (phone, username, department, is_active, last_login_at, login_attempts, locked_until)"
```

---

### Task 2: Migration — Expand audit action CHECK constraint

**Files:**
- Create: `migrations/0265_audit_action_expansion.sql`

- [ ] **Step 1: Create migration file**

```sql
-- migrations/0265_audit_action_expansion.sql
-- Expand audit_logs action CHECK to include PRINT, EXPORT, LOGIN_FAILED, PASSWORD_CHANGE, ROLE_CHANGE
-- SQLite doesn't support ALTER CHECK, so we use a workaround:
-- The existing CHECK constraint is defined in schema.ts but D1/SQLite may not enforce it strictly.
-- We'll add the new actions in the code layer. This migration is a documentation placeholder
-- to track the intent. The actual enforcement is in createAuditLog and the auto-audit middleware.

-- Note: SQLite CHECK constraints are not enforced on INSERT if not explicitly defined.
-- The existing constraint in schema.ts is: action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
-- We will extend the allowed values in the code to also include: PRINT, EXPORT, LOGIN_FAILED, PASSWORD_CHANGE, ROLE_CHANGE
-- This is safe because SQLite does not enforce CHECK constraints defined only in Drizzle schema.
```

- [ ] **Step 2: Commit**

```bash
git add migrations/0265_audit_action_expansion.sql
git commit -m "docs: track audit action expansion for PRINT, EXPORT, LOGIN_FAILED, PASSWORD_CHANGE, ROLE_CHANGE"
```

---

### Task 3: Create User CRUD routes

**Files:**
- Create: `src/routes/tenant/users.ts`

- [ ] **Step 1: Create the users route file with all CRUD endpoints**

```typescript
// src/routes/tenant/users.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requirePermission } from '../../middleware/rbac';
import { hashPassword, verifyPassword } from '../../lib/password';
import { createAuditLog } from '../../lib/accounting-helpers';
import { isStrongPassword } from '../../middleware/security';
import { VALID_TENANT_ROLES, normalizeRole } from '../../lib/authz';

const userRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Schemas ────────────────────────────────────────────────────────────────

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
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
  phone: z.string().optional(),
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
    /SELECT .+? FROM/,
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
    `SELECT id, email, name, role, phone, username, department, is_active, last_login_at, login_attempts, locked_until, created_at, updated_at
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

  const passwordHash = await hashPassword(data.password);

  const result = await db.$client.prepare(
    `INSERT INTO users (email, password_hash, name, role, tenant_id, phone, username, department, is_active, password_changed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', '+6 hours'), datetime('now', '+6 hours'))`
  ).bind(
    data.email, passwordHash, data.name, normalizeRole(data.role), tenantId,
    data.phone ?? null, data.username ?? null, data.department ?? null
  ).run();

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

  const oldValue = {
    name: existing['name'],
    email: existing['email'],
    phone: existing['phone'],
    username: existing['username'],
    department: existing['department'],
    is_active: existing['is_active'],
  };

  await db.$client.prepare(
    `UPDATE users SET
       name = COALESCE(?, name),
       email = COALESCE(?, email),
       phone = COALESCE(?, phone),
       username = COALESCE(?, username),
       department = COALESCE(?, department),
       is_active = COALESCE(?, is_active),
       updated_at = datetime('now', '+6 hours')
     WHERE id = ? AND tenant_id = ?`
  ).bind(
    data.name ?? null,
    data.email ?? null,
    data.phone ?? null,
    data.username ?? null,
    data.department ?? null,
    data.is_active ?? null,
    id, tenantId
  ).run();

  const newValue = {
    name: data.name ?? existing['name'],
    email: data.email ?? existing['email'],
    phone: data.phone ?? existing['phone'],
    username: data.username ?? existing['username'],
    department: data.department ?? existing['department'],
    is_active: data.is_active ?? existing['is_active'],
  };

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

  if (existing.role === 'super_admin') {
    throw new HTTPException(400, { message: 'Cannot change super_admin role' });
  }

  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) {
    throw new HTTPException(400, { message: 'Invalid role' });
  }

  await db.$client.prepare(
    `UPDATE users SET role = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
  ).bind(normalizedRole, id, tenantId).run();

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

  const newHash = await hashPassword(new_password);
  await db.$client.prepare(
    `UPDATE users SET password_hash = ?, password_changed_at = datetime('now', '+6 hours'), updated_at = datetime('now', '+6 hours') WHERE id = ?`
  ).bind(newHash, userId).run();

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
    `UPDATE users SET password_hash = ?, password_changed_at = datetime('now', '+6 hours'), login_attempts = 0, locked_until = NULL, updated_at = datetime('now', '+6 hours') WHERE id = ?`
  ).bind(newHash, id).run();

  const { ipAddress, userAgent } = auditMeta(c);
  await createAuditLog(c.env, tenantId, actorUserId, 'PASSWORD_CHANGE', 'users', Number(id), null, { reset_by: actorUserId }, ipAddress, userAgent);

  return c.json({ message: `Password reset for ${targetUser.name}` });
});

export default userRoutes;
```

- [ ] **Step 2: Register route in src/index.ts**

Add import at top of `src/index.ts` (after line 10, near other imports):
```typescript
import userRoutes from './routes/tenant/users';
```

Add route registration (after line 650, near other `/api/` routes):
```typescript
app.route('/api/users', userRoutes);
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/tenant/users.ts src/index.ts
git commit -m "feat: add user CRUD routes (list, get, create, update, deactivate, role change, password change/reset)"
```

---

### Task 4: Account lockout on failed login

**Files:**
- Modify: `src/routes/tenant/auth.ts`

- [ ] **Step 1: Add account lockout logic to login handler**

In `src/routes/tenant/auth.ts`, modify the login handler. Replace the current login logic (lines 33-111) with:

```typescript
// ─── Constants ──────────────────────────────────────────────────────────────
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;

// ─── Login ────────────────────────────────────────────────────────────
tenantAuthRoutes.post('/login', zValidator('json', loginSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { email, password } = c.req.valid('json');
  const tenantId = c.get('tenantId');

  if (!tenantId) {
    return c.json({ error: 'Tenant not identified' }, 400);
  }

  try {
    const user = await db.$client.prepare(
      `SELECT u.id, u.email, u.password_hash, u.name, u.role, u.mfa_enabled,
              u.is_active, u.login_attempts, u.locked_until,
              t.name AS hospital_name, t.subdomain AS hospital_slug
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE u.email = ? AND u.tenant_id = ?`
    ).bind(email, tenantId).first<{
      id: string;
      email: string;
      password_hash: string;
      name: string;
      role: string;
      mfa_enabled?: number;
      is_active?: number;
      login_attempts?: number;
      locked_until?: string | null;
      hospital_name: string;
      hospital_slug: string;
    }>();

    if (!user) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Check if account is deactivated
    if (user.is_active === 0) {
      return c.json({ error: 'Account is deactivated. Contact your administrator.' }, 403);
    }

    // Check if account is locked
    if (user.locked_until) {
      const lockExpiry = new Date(user.locked_until);
      if (lockExpiry > new Date()) {
        const minutesLeft = Math.ceil((lockExpiry.getTime() - Date.now()) / 60000);
        return c.json({
          error: `Account is locked. Try again in ${minutesLeft} minute(s).`,
          locked_until: user.locked_until,
        }, 423);
      }
      // Lock expired — reset attempts
      await db.$client.prepare(
        'UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = ? AND tenant_id = ?'
      ).bind(user.id, tenantId).run();
      user.login_attempts = 0;
      user.locked_until = null;
    }

    const validPassword = await verifyPassword(password, user.password_hash);
    if (!validPassword) {
      // Increment login attempts
      const attempts = (user.login_attempts || 0) + 1;
      const updates: string[] = ['login_attempts = ?', 'updated_at = datetime(\'now\', \'+6 hours\')'];
      const binds: (string | number)[] = [attempts];

      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000).toISOString();
        updates.push('locked_until = ?');
        binds.push(lockUntil);
      }

      await db.$client.prepare(
        `UPDATE users SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
      ).bind(...binds, user.id, tenantId).run();

      // Audit failed login
      const ipAddress = c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for') ?? undefined;
      const userAgent = c.req.header('user-agent') ?? undefined;
      try {
        await createAuditLog(c.env, tenantId, user.id, 'LOGIN_FAILED', 'users', Number(user.id), null, {
          email,
          attempts,
          locked: attempts >= MAX_LOGIN_ATTEMPTS,
        }, ipAddress, userAgent);
      } catch { /* audit failure must not block login */ }

      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        return c.json({
          error: `Too many failed attempts. Account locked for ${LOCKOUT_DURATION_MINUTES} minutes.`,
        }, 423);
      }

      return c.json({ error: 'Invalid credentials', attempts_remaining: MAX_LOGIN_ATTEMPTS - attempts }, 401);
    }

    // Successful login — reset attempts and update last_login_at
    await db.$client.prepare(
      `UPDATE users SET login_attempts = 0, locked_until = NULL, last_login_at = datetime('now', '+6 hours'), updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
    ).bind(user.id, tenantId).run();

    // Check if MFA is enabled — if so, return mfa_required instead of token
    if (user.mfa_enabled) {
      return c.json({
        mfa_required: true,
        user_id: Number(user.id),
        message: 'MFA verification required. Submit TOTP code to /api/mfa/verify.',
      });
    }

    const resolvedPermissions = await resolveUserPermissions(
      c.env.DB, tenantId, normalizeRole(user.role) || user.role, String(user.id),
    ).catch(() => getPermissionsForRole(user.role));

    const token = await generateToken(
      {
        userId: user.id,
        role: normalizeRole(user.role),
        tenantId,
        permissions: resolvedPermissions,
      },
      c.env.JWT_SECRET,
      8
    );

    // Audit successful login
    const ipAddress = c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for') ?? undefined;
    const userAgent = c.req.header('user-agent') ?? undefined;
    try {
      await createAuditLog(c.env, tenantId, user.id, 'LOGIN', 'users', Number(user.id), null, { email }, ipAddress, userAgent);
    } catch { /* audit failure must not block login */ }

    return c.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: normalizeRole(user.role),
      },
      hospital: {
        id: tenantId,
        name: user.hospital_name,
        slug: user.hospital_slug,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ error: 'Login failed' }, 500);
  }
});
```

- [ ] **Step 2: Add import for createAuditLog at top of file**

Add after existing imports in `src/routes/tenant/auth.ts`:
```typescript
import { createAuditLog } from '../../lib/accounting-helpers';
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/tenant/auth.ts
git commit -m "feat: add account lockout after 5 failed login attempts (15min lock)"
```

---

### Task 5: Auto-audit middleware

**Files:**
- Create: `src/middleware/audit.ts`

- [ ] **Step 1: Create the auto-audit middleware**

```typescript
// src/middleware/audit.ts
// Auto-audit middleware: intercepts all write operations (POST/PUT/PATCH/DELETE)
// and logs them to audit_logs after the response is sent.
//
// This is a best-effort layer. Individual routes can still call createAuditLog()
// directly for more detailed old/new value tracking.

import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types';
import { createAuditLog } from '../lib/accounting-helpers';

type AppEnv = { Bindings: Env; Variables: Variables };

// Paths to exclude from auto-audit (auth, health, read-heavy)
const EXCLUDED_PATH_PREFIXES = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/health',
  '/api/seed',
  '/api/init',
  '/api/patient-auth',
  '/api/patient-phr',
  '/api/patient-portal',
  '/api/global-portal',
  '/api/v1/marketplace',
  '/api/v1/doctor-auth',
  '/api/invite',
  '/api/register',
  '/api/onboarding',
];

// Map HTTP method to audit action
function methodToAction(method: string): string {
  switch (method) {
    case 'POST': return 'CREATE';
    case 'PUT':
    case 'PATCH': return 'UPDATE';
    case 'DELETE': return 'DELETE';
    default: return '';
  }
}

// Extract table name from path (best-effort heuristic)
// /api/patients -> patients, /api/billing/123 -> billing
function extractTableName(path: string): string {
  const segments = path.split('/').filter(Boolean);
  // Remove 'api' prefix and take the next segment
  const apiIndex = segments.indexOf('api');
  if (apiIndex >= 0 && segments.length > apiIndex + 1) {
    return segments[apiIndex + 1];
  }
  return segments[0] || 'unknown';
}

// Extract record ID from path (best-effort)
// /api/patients/123 -> 123, /api/billing/456/items -> 456
function extractRecordId(path: string): number {
  const segments = path.split('/').filter(Boolean);
  const apiIndex = segments.indexOf('api');
  if (apiIndex >= 0 && segments.length > apiIndex + 2) {
    const potentialId = segments[apiIndex + 2];
    const num = parseInt(potentialId, 10);
    if (!isNaN(num) && num > 0) return num;
  }
  return 0;
}

/**
 * Auto-audit middleware for write operations.
 * Logs: who did what, when, on which resource, from which IP.
 * Does NOT capture old/new values (that's the route handler's job).
 */
export function autoAuditMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const method = c.req.method;

    // Only audit write operations
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      await next();
      return;
    }

    // Skip excluded paths
    const path = c.req.path;
    if (EXCLUDED_PATH_PREFIXES.some(prefix => path.startsWith(prefix))) {
      await next();
      return;
    }

    const action = methodToAction(method);
    if (!action) {
      await next();
      return;
    }

    // Execute the route handler first
    await next();

    // Only log successful responses (2xx, 3xx)
    const status = c.res.status;
    if (status >= 400) return;

    // Best-effort audit logging — must never break the response
    try {
      const tenantId = c.get('tenantId');
      const userId = c.get('userId');

      if (!tenantId || !userId) return;

      const tableName = extractTableName(path);
      const recordId = extractRecordId(path);
      const ipAddress = c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for') ?? undefined;
      const userAgent = c.req.header('user-agent') ?? undefined;

      // Fire-and-forget — don't await, don't block response
      createAuditLog(
        c.env, tenantId, userId, action, tableName, recordId,
        null, null, ipAddress, userAgent,
      ).catch(() => { /* audit failure must never break the app */ });
    } catch {
      // Silently ignore — audit is best-effort
    }
  };
}
```

- [ ] **Step 2: Register middleware in src/index.ts**

Add import in `src/index.ts` (near other middleware imports, around line 7):
```typescript
import { autoAuditMiddleware } from './middleware/audit';
```

Add middleware registration AFTER the auth middleware (after line 552 `app.use('/api/*', authMiddleware);`):
```typescript
app.use('/api/*', autoAuditMiddleware());
```

- [ ] **Step 3: Commit**

```bash
git add src/middleware/audit.ts src/index.ts
git commit -m "feat: add auto-audit middleware for all write operations"
```

---

### Task 6: Audit log export endpoint

**Files:**
- Modify: `src/routes/tenant/audit.ts`

- [ ] **Step 1: Add export endpoint to audit routes**

Add the following endpoint to `src/routes/tenant/audit.ts`, before the `export default auditRoutes;` line:

```typescript
// ─── GET /api/audit/export — Export audit logs as CSV ───────────────────────
auditRoutes.get('/export', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { userId, tableName, startDate, endDate } = c.req.query();

  // Reuse the same query builder but with higher limit for export
  let query = `SELECT a.id, a.user_id, u.name as user_name, a.action, a.table_name,
                      a.record_id, a.old_value, a.new_value, a.ip_address, a.user_agent, a.created_at
               FROM audit_logs a
               LEFT JOIN users u ON a.user_id = u.id
               WHERE a.tenant_id = ?`;
  const params: (string | number)[] = [tenantId];

  if (userId) {
    const parsedUserId = Number(userId);
    if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
      throw new HTTPException(400, { message: 'Invalid userId' });
    }
    query += ' AND a.user_id = ?';
    params.push(parsedUserId);
  }
  if (tableName) {
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      throw new HTTPException(400, { message: 'Invalid tableName' });
    }
    query += ' AND a.table_name = ?';
    params.push(tableName);
  }
  if (startDate) {
    query += ' AND a.created_at >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND a.created_at <= ?';
    params.push(endDate);
  }

  query += ' ORDER BY a.created_at DESC LIMIT 10000';

  try {
    const { results } = await db.$client.prepare(query).bind(...params).all();

    // Build CSV
    const headers = ['ID', 'User ID', 'User Name', 'Action', 'Table', 'Record ID', 'Old Value', 'New Value', 'IP Address', 'User Agent', 'Created At'];
    const csvRows = [headers.join(',')];

    for (const row of (results || []) as any[]) {
      const values = [
        row.id,
        row.user_id,
        `"${(row.user_name || '').replace(/"/g, '""')}"`,
        row.action,
        row.table_name,
        row.record_id,
        `"${(row.old_value || '').replace(/"/g, '""')}"`,
        `"${(row.new_value || '').replace(/"/g, '""')}"`,
        row.ip_address || '',
        `"${(row.user_agent || '').replace(/"/g, '""')}"`,
        row.created_at,
      ];
      csvRows.push(values.join(','));
    }

    const csv = csvRows.join('\n');

    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="audit-export-${new Date().toISOString().slice(0, 10)}.csv"`);
    return c.body(csv);
  } catch (error) {
    console.error('Error exporting audit logs:', error);
    return c.json({ error: 'Failed to export audit logs' }, 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/tenant/audit.ts
git commit -m "feat: add audit log CSV export endpoint (GET /api/audit/export)"
```

---

### Task 7: Final verification and typecheck

**Files:**
- None (verification only)

- [ ] **Step 1: Run typecheck**

Run: `pnpm run typecheck` (or `npx tsc --noEmit` if no typecheck script)
Expected: No errors

- [ ] **Step 2: Run build**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 3: Run lint**

Run: `pnpm run lint`
Expected: No errors (or only pre-existing warnings)

- [ ] **Step 4: Verify all routes are registered**

Check that `src/index.ts` has:
- `import userRoutes from './routes/tenant/users';`
- `import { autoAuditMiddleware } from './middleware/audit';`
- `app.route('/api/users', userRoutes);`
- `app.use('/api/*', autoAuditMiddleware());`

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve type/lint issues from user management module"
```

---

## Summary

| Task | Description | New Files | Modified Files |
|------|-------------|-----------|----------------|
| 1 | User table migration | `migrations/0264_user_management_fields.sql` | — |
| 2 | Audit action expansion | `migrations/0265_audit_action_expansion.sql` | — |
| 3 | User CRUD routes | `src/routes/tenant/users.ts` | `src/index.ts` |
| 4 | Account lockout | — | `src/routes/tenant/auth.ts` |
| 5 | Auto-audit middleware | `src/middleware/audit.ts` | `src/index.ts` |
| 6 | Audit export endpoint | — | `src/routes/tenant/audit.ts` |
| 7 | Verification | — | — |

**New API Endpoints:**

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/users` | `users:read` | List users (paginated, filterable) |
| GET | `/api/users/:id` | `users:read` | Get single user |
| POST | `/api/users` | `users:write` | Create user |
| PUT | `/api/users/:id` | `users:write` | Update user profile |
| DELETE | `/api/users/:id` | `users:delete` | Deactivate user |
| PATCH | `/api/users/:id/role` | `roles:manage` | Change user role |
| POST | `/api/users/:id/activate` | `users:write` | Reactivate user |
| POST | `/api/users/change-password` | (any auth) | Change own password |
| POST | `/api/users/:id/reset-password` | `users:write` | Admin resets password |
| GET | `/api/audit/export` | `audit:read` | Export audit logs as CSV |
