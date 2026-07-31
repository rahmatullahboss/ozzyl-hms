/**
 * Public invitation routes — no auth/tenant middleware needed.
 * These look up invitations by token directly from DB.
 *
 * GET  /api/invite/:token          → Validate invitation token
 * POST /api/invite/:token/accept   → Accept invitation & create account
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { generateToken } from '../middleware/auth';
import { hashPassword } from '../lib/password';
import type { Env } from '../types';
import { getDb } from '../db';
import { getPermissionsForRole, normalizeRole } from '../lib/authz';
import { isStrongPassword } from '../middleware/security';
import { isAllowedTenantInviteRole } from '../lib/staff-invite-policy';


const publicInviteRoutes = new Hono<{ Bindings: Env }>();

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const acceptSchema = z.object({
  name: z.string().min(1, 'Name required'),
  email: z.string().email('Valid email required').optional(),
  password: z.string().min(8, 'Password must be at least 8 characters')
    .refine(isStrongPassword, 'Password must contain at least 1 uppercase letter, 1 lowercase letter, and 1 number'),
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUniqueEmailConstraintError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return message.includes('UNIQUE constraint failed: users.email')
    || (message.includes('SQLITE_CONSTRAINT_UNIQUE') && message.includes('users.email'));
}

function logInviteAcceptEvent(params: {
  event: 'invite_accept_duplicate_email' | 'invite_accept_failed';
  severity: 'warning' | 'critical';
  path: string;
  method: string;
  status: number;
  token: string;
  tenantId?: number | string | null;
  inviteId?: number | string | null;
  email?: string | null;
  error?: unknown;
}): void {
  console.error(JSON.stringify({
    level: params.status >= 500 ? 'error' : 'warn',
    tag: params.status >= 500 ? 'http_5xx_response' : 'handled_conflict',
    ...params,
    tokenPrefix: params.token.slice(0, 8),
    email: params.email ? params.email.replace(/^(.).+(@.+)$/, '$1***$2') : undefined,
    message: params.error ? getErrorMessage(params.error) : undefined,
    stack: params.error instanceof Error ? params.error.stack : undefined,
    timestamp: new Date().toISOString(),
  }));
}

// ─── GET /api/invite/:token — Validate token ──────────────────────────
publicInviteRoutes.get('/:token', async (c) => {
  const db = getDb(c.env.DB);
  const token = c.req.param('token');
  const tokenHash = await sha256Hex(token);

  try {
    const invite = await db.$client.prepare(
      `SELECT i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at,
              i.doctor_id, i.staff_id,
              d.name AS doctor_name,
              s.name AS staff_name,
              t.name AS hospital_name, t.subdomain
       FROM invitations i
       JOIN tenants t ON t.id = i.tenant_id
       LEFT JOIN doctors d ON d.id = i.doctor_id AND d.tenant_id = i.tenant_id
       LEFT JOIN staff   s ON s.id = i.staff_id   AND s.tenant_id = i.tenant_id
       WHERE i.token IN (?, ?)`
    ).bind(token, tokenHash).first<{
      email: string | null;
      role: string;
      expires_at: string;
      accepted_at: string | null;
      revoked_at: string | null;
      doctor_id: number | null;
      staff_id: number | null;
      doctor_name: string | null;
      staff_name: string | null;
      hospital_name: string;
      subdomain: string;
    }>();

    if (!invite) {
      return c.json({ error: 'Invitation not found or already invalid' }, 404);
    }
    if (invite.accepted_at) {
      return c.json({ error: 'This invitation has already been accepted' }, 410);
    }
    if (invite.revoked_at) {
      return c.json({ error: 'This invitation has been revoked' }, 410);
    }
    if (new Date(invite.expires_at) < new Date()) {
      return c.json({ error: 'This invitation has expired' }, 410);
    }
    const normalizedInviteRole = normalizeRole(invite.role);
    if (!isAllowedTenantInviteRole(normalizedInviteRole)) {
      return c.json({ error: 'This invitation role is no longer allowed' }, 403);
    }

    return c.json({
      valid: true,
      email: invite.email,
      role: normalizedInviteRole,
      doctorId:   invite.doctor_id,
      doctorName: invite.doctor_name,
      staffId:    invite.staff_id,
      staffName:  invite.staff_name,
      hospitalName: invite.hospital_name,
      slug: invite.subdomain,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(JSON.stringify({ event: 'invite_validate_failed', path: c.req.path, message }));
    return c.json({ error: 'Failed to validate invitation' }, 500);
  }
});

// ─── POST /api/invite/:token/accept — Accept + create account + link doctor ─────
publicInviteRoutes.post('/:token/accept', zValidator('json', acceptSchema), async (c) => {
  const db = getDb(c.env.DB);
  const token = c.req.param('token');
  const { name, email: submittedEmail, password } = c.req.valid('json');
  const tokenHash = await sha256Hex(token);

  try {
    const invite = await db.$client.prepare(
      `SELECT i.id, i.email, i.role, i.tenant_id, i.expires_at, i.accepted_at, i.revoked_at,
              i.doctor_id, i.staff_id
       FROM invitations i
       WHERE i.token IN (?, ?)`
    ).bind(token, tokenHash).first<{
      id: number;
      email: string | null;
      role: string;
      tenant_id: number;
      expires_at: string;
      accepted_at: string | null;
      revoked_at: string | null;
      doctor_id: number | null;
      staff_id: number | null;
    }>();

    if (!invite) return c.json({ error: 'Invalid invitation token' }, 404);
    if (invite.accepted_at) return c.json({ error: 'Invitation already used' }, 410);
    if (invite.revoked_at) return c.json({ error: 'Invitation has been revoked' }, 410);
    if (new Date(invite.expires_at) < new Date()) return c.json({ error: 'Invitation expired' }, 410);
    const normalizedInviteRole = normalizeRole(invite.role);
    if (!isAllowedTenantInviteRole(normalizedInviteRole)) {
      return c.json({ error: 'This invitation role is no longer allowed' }, 403);
    }

    const finalEmail = (invite.email ?? submittedEmail ?? '').trim().toLowerCase();
    if (!finalEmail) {
      return c.json({ error: 'Email is required' }, 400);
    }

    // In multi-tenant HMS, the same email may legitimately exist in another hospital.
    // Only block duplicate accounts inside the same tenant/hospital.
    const existingUser = await db.$client.prepare(
      'SELECT id FROM users WHERE lower(email) = lower(?) AND tenant_id = ? LIMIT 1'
    ).bind(finalEmail, invite.tenant_id).first<{ id: number }>();

    if (existingUser) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'invite_accept_duplicate_email_precheck',
        severity: 'warning',
        tag: 'handled_conflict',
        path: c.req.path,
        method: c.req.method,
        status: 409,
        tokenPrefix: token.slice(0, 8),
        tenantId: invite.tenant_id,
        inviteId: invite.id,
        existingUserId: existingUser.id,
        email: finalEmail.replace(/^(.).+(@.+)$/, '$1***$2'),
        timestamp: new Date().toISOString(),
      }));
      return c.json({
        error: 'An account with this email already exists in this hospital. Please log in instead.',
      }, 409);
    }

    // If linking to a doctor, ensure that doctor is still unlinked
    if (invite.doctor_id) {
      const doctor = await db.$client.prepare(
        'SELECT id, user_id FROM doctors WHERE id = ? AND tenant_id = ?'
      ).bind(invite.doctor_id, invite.tenant_id).first<{ id: number; user_id: number | null }>();
      if (!doctor) {
        return c.json({ error: 'Linked doctor profile no longer exists' }, 410);
      }
      if (doctor.user_id) {
        return c.json({ error: 'This doctor profile is already linked to a different user' }, 409);
      }
    }

    // If linking to a staff member, ensure that staff row is still unlinked
    if (invite.staff_id) {
      const member = await db.$client.prepare(
        'SELECT id, user_id FROM staff WHERE id = ? AND tenant_id = ?'
      ).bind(invite.staff_id, invite.tenant_id).first<{ id: number; user_id: number | null }>();
      if (!member) {
        return c.json({ error: 'Linked staff profile no longer exists' }, 410);
      }
      if (member.user_id) {
        return c.json({ error: 'This staff profile is already linked to a different user' }, 409);
      }
    }

    const passwordHash = await hashPassword(password);

    // Create user atomically
    const [userResult] = await db.$client.batch([
      db.$client.prepare(
        'INSERT INTO users (email, password_hash, name, role, tenant_id, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))'
      ).bind(finalEmail, passwordHash, name, normalizedInviteRole, invite.tenant_id),
    ]);

    const userId = Number(userResult.meta.last_row_id);

    // Mark accepted + (if doctor) link doctors.user_id
    const followups: D1PreparedStatement[] = [
      db.$client.prepare(
        'UPDATE invitations SET accepted_at = datetime("now"), email = COALESCE(email, ?) WHERE id = ?'
      ).bind(finalEmail, invite.id),
    ];
    if (invite.doctor_id) {
      followups.push(db.$client.prepare(
        'UPDATE doctors SET user_id = ?, email = COALESCE(NULLIF(email, ""), ?) WHERE id = ? AND tenant_id = ? AND user_id IS NULL'
      ).bind(userId, finalEmail, invite.doctor_id, invite.tenant_id));
    }
    if (invite.staff_id) {
      followups.push(db.$client.prepare(
        'UPDATE staff SET user_id = ? WHERE id = ? AND tenant_id = ? AND user_id IS NULL'
      ).bind(userId, invite.staff_id, invite.tenant_id));
    }
    await db.$client.batch(followups);

    const jwtToken = await generateToken(
      {
        userId: String(userId),
        role: normalizedInviteRole,
        tenantId: String(invite.tenant_id),
        permissions: getPermissionsForRole(normalizedInviteRole),
      },
      c.env.JWT_SECRET,
      8
    );

    return c.json({
      message: 'Account created successfully',
      token: jwtToken,
      user: { id: userId, name, email: finalEmail, role: normalizedInviteRole },
    }, 201);
  } catch (error) {
    if (isUniqueEmailConstraintError(error)) {
      logInviteAcceptEvent({
        event: 'invite_accept_duplicate_email',
        severity: 'warning',
        path: c.req.path,
        method: c.req.method,
        status: 409,
        token,
        error,
      });
      return c.json({
        error: 'An account with this email already exists. Please log in instead.',
      }, 409);
    }

    logInviteAcceptEvent({
      event: 'invite_accept_failed',
      severity: 'critical',
      path: c.req.path,
      method: c.req.method,
      status: 500,
      token,
      error,
    });
    return c.json({ error: 'Failed to accept invitation' }, 500);
  }
});

export default publicInviteRoutes;
