import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { verify } from 'hono/jwt';
import { blacklistToken, generateToken, type JWTPayload } from '../../middleware/auth';
import { isStrongPassword } from '../../middleware/security';
import type { Env, Variables } from '../../types';
import { getDb } from '../../db';
import { VALID_TENANT_ROLES, getPermissionsForRole, normalizeRole } from '../../lib/authz';
import { resolveUserPermissions } from '../../middleware/rbac';
import { hashPassword, verifyPassword } from '../../lib/password';
import { createAuditLog } from '../../lib/accounting-helpers';
import { normalizeBangladeshMobile } from '../../lib/bangladesh-phone';
import {
  clearStaffSessionCookie,
  getStaffSessionCookie,
  setStaffSessionCookie,
} from '../../lib/staff-session-cookie';

const MAX_LOGIN_ATTEMPTS = 20;
const LOCKOUT_DURATION_MINUTES = 15;

const tenantAuthRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

/**
 * Issue a fresh 8-hour staff access token and embed the resolved
 * permission list. Used by both /login and /refresh so the two flows
 * stay byte-for-byte equivalent.
 */
async function issueStaffAccessToken(
  c: { env: Env },
  user: { id: string | number; role: string; tenantId: string | number },
): Promise<string> {
  const tenantId = String(user.tenantId);
  const role = normalizeRole(user.role) || user.role;
  const resolvedPermissions = await resolveUserPermissions(
    c.env.DB,
    tenantId,
    role,
    String(user.id),
  ).catch(() => getPermissionsForRole(role));
  return generateToken(
    {
      userId: String(user.id),
      role,
      tenantId,
      permissions: resolvedPermissions,
    },
    c.env.JWT_SECRET,
    8,
  );
}

// ─── Validation schemas ──────────────────────────────────────────────
const loginSchema = z.object({
  email: z.string().min(1, { message: 'Email or mobile required' }),
  password: z.string().min(1, { message: 'Password required' }),
});

const registerSchema = z.object({
  email: z.string().email({ message: 'Valid email required' }),
  password: z.string().min(8, { message: 'Password must be at least 8 characters' })
    .refine(isStrongPassword, 'Password must contain at least 1 uppercase letter, 1 lowercase letter, and 1 number'),
  name: z.string().min(1, { message: 'Name required' }),
  role: z.enum(VALID_TENANT_ROLES, { message: 'Invalid role' }),
});

// ─── Login ────────────────────────────────────────────────────────────
tenantAuthRoutes.post('/login', zValidator('json', loginSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { email, password } = c.req.valid('json');
  const tenantId = c.get('tenantId');

  if (!tenantId) {
    return c.json({ error: 'Tenant not identified' }, 400);
  }

  try {
    const rawIdentifier = email.trim();
    const normalizedMobile = normalizeBangladeshMobile(rawIdentifier);
    const loginIdentifier = normalizedMobile ?? rawIdentifier;
    const loginQuery = normalizedMobile
      ? `SELECT u.id, u.email, u.password_hash, u.name, u.role, u.mfa_enabled,
              u.is_active, u.login_attempts, u.locked_until,
              t.name AS hospital_name, t.subdomain AS hospital_slug
         FROM users u
         JOIN tenants t ON t.id = u.tenant_id
         WHERE u.mobile = ? AND u.tenant_id = ?`
      : `SELECT u.id, u.email, u.password_hash, u.name, u.role, u.mfa_enabled,
              u.is_active, u.login_attempts, u.locked_until,
              t.name AS hospital_name, t.subdomain AS hospital_slug
         FROM users u
         JOIN tenants t ON t.id = u.tenant_id
         WHERE u.email = ? AND u.tenant_id = ?`;
    const user = await db.$client.prepare(loginQuery).bind(loginIdentifier, tenantId).first<{
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
      // Atomic increment: only succeeds if below lockout threshold.
      // Prevents concurrent requests from both passing the lockout check.
      const updateResult = await db.$client.prepare(
        `UPDATE users SET login_attempts = login_attempts + 1, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ? AND login_attempts < ?`
      ).bind(user.id, tenantId, MAX_LOGIN_ATTEMPTS).run();

      // Re-read the persisted login_attempts to get the actual value after atomic update.
      // This handles concurrent increments correctly — we always see the true count.
      const freshUser = await db.$client.prepare(
        'SELECT login_attempts FROM users WHERE id = ? AND tenant_id = ?'
      ).bind(user.id, tenantId).first<{ login_attempts: number }>();
      const currentAttempts = freshUser?.login_attempts ?? 0;

      // changes=0 means already at MAX (guard prevented increment) → locked.
      // Otherwise check if persisted count reached the threshold.
      const locked = (updateResult.meta as any).changes === 0 || currentAttempts >= MAX_LOGIN_ATTEMPTS;

      if (locked) {
        const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000).toISOString();
        await db.$client.prepare(
          `UPDATE users SET locked_until = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
        ).bind(lockUntil, user.id, tenantId).run();
      }

      // Audit failed login
      const ipAddress = c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for') ?? undefined;
      const userAgent = c.req.header('user-agent') ?? undefined;
      try {
        await createAuditLog(c.env, tenantId, user.id, 'LOGIN_FAILED', 'users', Number(user.id), null, {
          email,
          locked,
        }, ipAddress, userAgent);
      } catch { /* audit failure must not block login */ }

      if (locked) {
        return c.json({
          error: `Too many failed attempts. Account locked for ${LOCKOUT_DURATION_MINUTES} minutes.`,
        }, 423);
      }

      return c.json({ error: 'Invalid credentials', attempts_remaining: Math.max(0, MAX_LOGIN_ATTEMPTS - currentAttempts) }, 401);
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

    const token = await issueStaffAccessToken(c, {
      id: user.id,
      role: user.role,
      tenantId,
    });
    setStaffSessionCookie(c, token);

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

// ─── Register (requires hospital_admin role) ─────────────────────────
tenantAuthRoutes.post('/register', zValidator('json', registerSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { email, password, name, role } = c.req.valid('json');
  const tenantId = c.get('tenantId');
  const callerRole = c.get('role');

  if (!tenantId) {
    return c.json({ error: 'Tenant not identified' }, 400);
  }

  // Only hospital_admin can create users
  if (callerRole !== 'hospital_admin') {
    return c.json({ error: 'Forbidden: only hospital_admin can register users' }, 403);
  }

  try {
    // Check if email already exists for this tenant
    const existing = await db.$client.prepare(
      'SELECT id FROM users WHERE email = ? AND tenant_id = ?'
    ).bind(email, tenantId).first();

    if (existing) {
      return c.json({ error: 'User with this email already exists' }, 409);
    }

    const passwordHash = await hashPassword(password);

    const result = await db.$client.prepare(
      'INSERT INTO users (email, password_hash, name, role, tenant_id, created_at) VALUES (?, ?, ?, ?, ?, datetime("now", "+6 hours"))'
    ).bind(email, passwordHash, name, normalizeRole(role), tenantId).run();

    // Audit user creation via registration
    const ipAddress = c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for') ?? undefined;
    const userAgent = c.req.header('user-agent') ?? undefined;
    const callerUserId = c.get('userId') ?? '0';
    try {
      await createAuditLog(c.env, tenantId, callerUserId, 'CREATE', 'users', result.meta.last_row_id as number, null, {
        email,
        name,
        role,
        created_by: 'admin-registration',
      }, ipAddress, userAgent);
    } catch { /* audit failure must not block registration */ }

    return c.json({
      message: 'User created successfully',
      userId: result.meta.last_row_id,
    }, 201);
  } catch (error) {
    console.error('Register error:', error);
    return c.json({ error: 'Registration failed' }, 500);
  }
});

// ─── Refresh (HttpOnly cookie → fresh in-memory access token) ──────
tenantAuthRoutes.post('/refresh', async (c) => {
  const tenantId = c.get('tenantId');
  if (!tenantId) {
    return c.json({ error: 'Tenant not identified' }, 400);
  }
  if (!c.env.JWT_SECRET) {
    return c.json({ error: 'Server configuration error' }, 500);
  }

  const sessionToken = getStaffSessionCookie(c);
  if (!sessionToken) {
    return c.json({ error: 'No active session' }, 401);
  }

  try {
    const decoded = (await verify(sessionToken, c.env.JWT_SECRET, 'HS256')) as unknown as JWTPayload;
    if (!decoded.tenantId || String(decoded.tenantId) !== String(tenantId)) {
      clearStaffSessionCookie(c);
      return c.json({ error: 'Session tenant mismatch' }, 403);
    }

    const db = getDb(c.env.DB);
    const user = await db.$client.prepare(`
      SELECT u.id, u.email, u.name, u.role, u.is_active,
             t.name AS hospital_name, t.subdomain AS hospital_slug
      FROM users u
      JOIN tenants t ON t.id = u.tenant_id
      WHERE u.id = ?
        AND u.tenant_id = ?
        AND t.status = 'active'
    `).bind(decoded.userId, tenantId).first<{
      id: string;
      email: string;
      name: string;
      role: string;
      is_active?: number;
      hospital_name: string;
      hospital_slug: string;
    }>();

    if (!user || user.is_active === 0) {
      clearStaffSessionCookie(c);
      return c.json({ error: 'Session is no longer valid' }, 401);
    }

    const token = await issueStaffAccessToken(c, {
      id: user.id,
      role: user.role,
      tenantId,
    });
    setStaffSessionCookie(c, token);

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
  } catch {
    clearStaffSessionCookie(c);
    return c.json({ error: 'Session expired' }, 401);
  }
});

// ─── Logout ───────────────────────────────────────────────────────────
tenantAuthRoutes.post('/logout', async (c) => {
  // Always clear the HttpOnly refresh cookie so the SPA cannot bring the
  // session back after reload.
  clearStaffSessionCookie(c);

  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return c.json({ message: 'Logged out' });
  }

  const token = authHeader.substring(7);

  try {
    // Blacklist token for 8 hours (matching token lifetime)
    await blacklistToken(token, c.env.KV, 8 * 3600);
    return c.json({ message: 'Logged out successfully' });
  } catch {
    return c.json({ message: 'Logged out' });
  }
});

export default tenantAuthRoutes;
