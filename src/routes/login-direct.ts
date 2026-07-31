/**
 * Direct login — no tenant slug required.
 *
 * POST /api/auth/login-direct
 *   body: { email, password }
 *   → Looks up user by email across all tenants
 *   → If exactly one match → login + return slug
 *   → If multiple matches → return hospital list to pick from
 *
 * SECURITY (P0-03): hardened to match the tenant login flow:
 *   • Per-IP rate limit via `loginRateLimit`
 *   • Per-email account lockout (5 attempts → 15 min lockout)
 *   • Audit log for both successful and failed logins
 *   • Audit log includes IP, UA, tenant context (when resolved)
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { generateToken } from '../middleware/auth';
import type { Env } from '../types';
import { getDb } from '../db';
import { getPermissionsForRole, normalizeRole } from '../lib/authz';
import { resolveUserPermissions } from '../middleware/rbac';
import { hashPassword, isLegacyBcryptHash, verifyPassword } from '../lib/password';
import { loginRateLimit } from '../middleware/rate-limit';
import {
  clearAccountLockout,
  getAccountLockoutState,
  recordFailedLoginAttempt,
} from '../middleware/rate-limit';
import { createAuditLog } from '../lib/accounting-helpers';
import { setStaffSessionCookie } from '../lib/staff-session-cookie';
import { normalizeBangladeshMobile } from '../lib/bangladesh-phone';


const loginDirectRoutes = new Hono<{ Bindings: Env }>();

const loginSchema = z.object({
  email: z.string().min(1, { message: 'Email or mobile required' }),
  password: z.string().min(1, { message: 'Password required' }),
  // Optional: if user picked a specific tenant from multi-tenant list
  tenantId: z.number().optional(),
});

type PasswordCandidate = {
  password_hash: string | null | undefined;
};

type PasswordVerifier = (
  password: string,
  storedHash: string | null | undefined,
) => Promise<boolean>;

/**
 * Verify each distinct password hash at most once.
 *
 * Multi-hospital accounts commonly reuse the same password hash across tenant
 * rows. Re-running PBKDF2/bcrypt for every row can exhaust a Worker's CPU
 * budget, so cache the result by stored hash for the duration of this request.
 */
export async function findPasswordMatchingUsers<T extends PasswordCandidate>(
  users: readonly T[],
  password: string,
  verifier: PasswordVerifier = verifyPassword,
): Promise<T[]> {
  const verificationByHash = new Map<string, boolean>();
  const matchingUsers: T[] = [];

  for (const user of users) {
    const storedHash = user.password_hash;
    if (!storedHash) continue;

    let matches = verificationByHash.get(storedHash);
    if (matches === undefined) {
      matches = await verifier(password, storedHash);
      verificationByHash.set(storedHash, matches);
    }

    if (matches) {
      matchingUsers.push(user);
    }
  }

  return matchingUsers;
}

// ─── POST /api/auth/login-direct ──────────────────────────────────────
loginDirectRoutes.post('/', loginRateLimit, zValidator('json', loginSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { email, password, tenantId: selectedTenantId } = c.req.valid('json');
  const ipAddress = c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for') ?? undefined;
  const rawIdentifier = email.trim();
  const normalizedMobile = normalizeBangladeshMobile(rawIdentifier);
  const loginIdentifier = normalizedMobile ?? rawIdentifier;
  const userAgent = c.req.header('user-agent') ?? undefined;

  // SECURITY (P0-03): If the account is already locked, short-circuit
  // before doing the expensive user lookup / password verify.
  const lockState = await getAccountLockoutState(c.env.KV, loginIdentifier);
  if (lockState.locked) {
    try {
      await createAuditLog(
        c.env,
        '0', // no tenant resolved yet
        '0', // no user resolved yet
        'LOGIN_LOCKED',
        'users',
        0,
        null,
        { email, reason: 'account_locked', retryAfterSeconds: lockState.retryAfterSeconds },
        ipAddress,
        userAgent,
      );
    } catch { /* audit failure must not block login */ }
    return c.json({
      error: `Account is locked. Try again in ${Math.ceil(lockState.retryAfterSeconds / 60)} minute(s).`,
      locked: true,
      retryAfterSeconds: lockState.retryAfterSeconds,
    }, 423);
  }

  try {
    // Find all users with this email or mobile (could be in multiple hospitals)
    const isMobile = normalizedMobile !== null;
    const { results: users } = await db.$client.prepare(
      `SELECT u.id, u.email, u.password_hash, u.name, u.role, u.tenant_id,
              t.name AS hospital_name, t.subdomain AS slug, t.status AS tenant_status
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE ${isMobile ? 'u.mobile' : 'u.email'} = ?`
    ).bind(loginIdentifier).all<{
      id: number;
      email: string;
      password_hash: string;
      name: string;
      role: string;
      tenant_id: number;
      hospital_name: string;
      slug: string;
      tenant_status: string;
    }>();

    if (!users || users.length === 0) {
      // SECURITY (P0-03): even when the email is unknown, record a failed
      // attempt so an attacker cannot probe for valid emails by timing
      // the response. Use the email as the lockout identifier.
      const unknownState = await recordFailedLoginAttempt(c.env.KV, loginIdentifier);
      try {
        await createAuditLog(
          c.env, '0', '0', 'LOGIN_FAILED', 'users', 0,
          null, { email, reason: 'unknown_user' }, ipAddress, userAgent,
        );
      } catch { /* audit failure must not block login */ }
      if (unknownState.locked) {
        return c.json({
          error: `Too many failed attempts. Try again in ${Math.ceil(unknownState.retryAfterSeconds / 60)} minute(s).`,
          locked: true,
        }, 423);
      }
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Guard: ensure JWT_SECRET is configured
    if (!c.env.JWT_SECRET) {
      console.error('JWT_SECRET not configured');
      return c.json({ error: 'Server configuration error' }, 500);
    }

    // Filter out inactive/suspended tenants
    const activeUsers = users.filter((u) => u.tenant_status === 'active');
    if (activeUsers.length === 0) {
      try {
        await createAuditLog(
          c.env, '0', '0', 'LOGIN_FAILED', 'users', 0,
          null, { email, reason: 'no_active_tenant' }, ipAddress, userAgent,
        );
      } catch { /* audit failure must not block login */ }
      return c.json({ error: 'Your hospital account is inactive or suspended' }, 403);
    }

    // If user selected a specific tenant (multi-hospital scenario)
    let targetUser = activeUsers[0];
    let passwordAlreadyVerified = false;

    if (selectedTenantId) {
      const found = activeUsers.find((u) => u.tenant_id === selectedTenantId);
      if (!found) {
        const failState = await recordFailedLoginAttempt(c.env.KV, loginIdentifier);
        try {
          await createAuditLog(
            c.env, '0', '0', 'LOGIN_FAILED', 'users', 0,
            null, { email, reason: 'tenant_mismatch', selectedTenantId }, ipAddress, userAgent,
          );
        } catch { /* audit failure must not block login */ }
        if (failState.locked) {
          return c.json({
            error: `Too many failed attempts. Try again in ${Math.ceil(failState.retryAfterSeconds / 60)} minute(s).`,
            locked: true,
          }, 423);
        }
        return c.json({ error: 'Invalid credentials' }, 401);
      }
      targetUser = found;
    } else if (activeUsers.length > 1) {
      const matchingUsers = await findPasswordMatchingUsers(activeUsers, password);

      if (matchingUsers.length === 0) {
        const failState = await recordFailedLoginAttempt(c.env.KV, loginIdentifier);
        try {
          await createAuditLog(
            c.env, '0', '0', 'LOGIN_FAILED', 'users', 0,
            null, { email, reason: 'multi_tenant_no_match' }, ipAddress, userAgent,
          );
        } catch { /* audit failure must not block login */ }
        if (failState.locked) {
          return c.json({
            error: `Too many failed attempts. Try again in ${Math.ceil(failState.retryAfterSeconds / 60)} minute(s).`,
            locked: true,
          }, 423);
        }
        return c.json({ error: 'Invalid credentials' }, 401);
      }
      if (matchingUsers.length === 1) {
        targetUser = matchingUsers[0];
        passwordAlreadyVerified = true;
      } else {
        return c.json({
          requireHospitalSelection: true,
          hospitals: matchingUsers.map((u) => ({
            tenantId: u.tenant_id,
            hospitalName: u.hospital_name,
            slug: u.slug,
            role: normalizeRole(u.role),
          })),
        });
      }
    }

    // Verify password. The multi-tenant matching path already verified the
    // selected user's hash, so do not repeat the expensive PBKDF2/bcrypt call.
    if (!targetUser.password_hash) {
      try {
        await createAuditLog(
          c.env, String(targetUser.tenant_id), String(targetUser.id), 'LOGIN_FAILED', 'users', targetUser.id,
          null, { email, reason: 'google_only_account' }, ipAddress, userAgent,
        );
      } catch { /* audit failure must not block login */ }
      return c.json({ error: 'This account uses Google login. Please use Google Sign-In.' }, 400);
    }
    const validPassword = passwordAlreadyVerified
      || await verifyPassword(password, targetUser.password_hash);
    if (!validPassword) {
      const failState = await recordFailedLoginAttempt(c.env.KV, loginIdentifier);
      try {
        await createAuditLog(
          c.env, String(targetUser.tenant_id), String(targetUser.id), 'LOGIN_FAILED', 'users', targetUser.id,
          null, {
            email,
            reason: 'bad_password',
            locked: failState.locked,
            attempts: failState.attempts,
          }, ipAddress, userAgent,
        );
      } catch { /* audit failure must not block login */ }
      if (failState.locked) {
        return c.json({
          error: `Too many failed attempts. Try again in ${Math.ceil(failState.retryAfterSeconds / 60)} minute(s).`,
          locked: true,
        }, 423);
      }
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Legacy bcrypt is pure JavaScript in Workers and can exceed the 10 ms Free-plan
    // CPU ceiling. Upgrade it after a successful login so subsequent requests use
    // the native Web Crypto PBKDF2 path. A concurrent password change wins.
    if (isLegacyBcryptHash(targetUser.password_hash)) {
      try {
        const upgradedHash = await hashPassword(password);
        await db.$client.prepare(
          `UPDATE users
           SET password_hash = ?, updated_at = datetime('now', '+6 hours')
           WHERE id = ? AND tenant_id = ? AND password_hash = ?`
        ).bind(upgradedHash, targetUser.id, targetUser.tenant_id, targetUser.password_hash).run();
        targetUser.password_hash = upgradedHash;
      } catch (error) {
        console.error('Direct login password hash upgrade failed:', error);
      }
    }

    // SECURITY (P0-03): Successful login — clear the per-email lockout counter
    // so a future lockout requires a fresh 5-failure window.
    await clearAccountLockout(c.env.KV, loginIdentifier);

    const normalizedRole = normalizeRole(targetUser.role) || targetUser.role;
    const resolvedPermissions = await resolveUserPermissions(
      c.env.DB,
      String(targetUser.tenant_id),
      normalizedRole,
      String(targetUser.id),
    ).catch((error) => {
      console.error('Direct login permission resolution failed, falling back to static role permissions:', error);
      return getPermissionsForRole(normalizedRole);
    });

    // Generate JWT
    const token = await generateToken(
      {
        userId: String(targetUser.id),
        role: normalizedRole,
        tenantId: String(targetUser.tenant_id),
        permissions: resolvedPermissions,
      },
      c.env.JWT_SECRET,
      8
    );

    // Set HttpOnly refresh cookie so the SPA can recover the in-memory
    // access token after a hard reload (P0-34 follow-up).
    setStaffSessionCookie(c, token);

    // SECURITY (P0-03): Audit successful login with IP, UA, and tenant context.
    try {
      await createAuditLog(
        c.env, String(targetUser.tenant_id), String(targetUser.id), 'LOGIN', 'users', targetUser.id,
        null, { email, slug: targetUser.slug }, ipAddress, userAgent,
      );
    } catch { /* audit failure must not block login */ }

    return c.json({
      token,
      slug: targetUser.slug,
      user: {
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.name,
        role: normalizeRole(targetUser.role),
      },
      hospital: {
        id: targetUser.tenant_id,
        name: targetUser.hospital_name,
        slug: targetUser.slug,
      },
    });
  } catch (error) {
    console.error('Direct login error:', error);
    return c.json({ error: 'Login failed' }, 500);
  }
});

export default loginDirectRoutes;
