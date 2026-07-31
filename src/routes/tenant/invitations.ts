/**
 * Protected invitation routes (require tenant + auth middleware).
 *
 * POST /api/invitations    → Create invitation (hospital_admin only)
 * GET  /api/invitations    → List invitations (hospital_admin only)
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { normalizeRole } from '../../lib/authz';
import { createAuditLog } from '../../lib/accounting-helpers';
import { createInvitationSchema } from '../../schemas/invitation';
import { sendEmail, EmailTemplates } from '../../lib/email';
import { buildInvitePath, buildAbsoluteInviteUrl } from '../../lib/staff-invite';
import { requirePermission, resolveUserPermissions } from '../../middleware/rbac';
import { isPrivilegedStaffInviteRole } from '../../lib/staff-invite-policy';

const invitationRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

invitationRoutes.use('/*', requirePermission('staff:write'));

// ─── Helpers ───────────────────────────────────────────────────────────

/** Generate a 32-byte crypto-safe random hex token */
function generateInviteToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Return ISO string 7 days from now */
function expiresIn7Days(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString();
}

// ─── POST /api/invitations — Create invitation (staff:write) ──
invitationRoutes.post('/', zValidator('json', createInvitationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const callerId = requireUserId(c);
  const callerRole = c.get('role');

  const { email, role, doctorId } = c.req.valid('json');
  const normalizedInviteRole = normalizeRole(role);

  if (isPrivilegedStaffInviteRole(normalizedInviteRole) && callerRole !== 'hospital_admin') {
    const callerPermissions = await resolveUserPermissions(
      c.env.DB,
      String(tenantId),
      String(callerRole),
      String(callerId),
    );
    if (!callerPermissions.includes('*') && !callerPermissions.includes('roles:manage')) {
      return c.json({ error: 'Inviting management roles requires roles:manage permission' }, 403);
    }
  }

  try {
    // Check if email already has an account in this tenant
    const existingUser = await db.$client.prepare(
      'SELECT id FROM users WHERE email = ? AND tenant_id = ?'
    ).bind(email, tenantId).first();

    if (existingUser) {
      return c.json({ error: 'A user with this email already exists in your hospital' }, 409);
    }

    // Check for pending invitation
    const existingInvite = await db.$client.prepare(
      'SELECT id FROM invitations WHERE email = ? AND tenant_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND datetime(expires_at) > datetime("now")'
    ).bind(email, tenantId).first();

    if (existingInvite) {
      return c.json({ error: 'A pending invitation already exists for this email' }, 409);
    }

    // If role=doctor, verify the doctor profile exists in this tenant and is unlinked
    let doctorName: string | null = null;
    if (role === 'doctor' && doctorId) {
      const doctor = await db.$client.prepare(
        'SELECT id, name, user_id FROM doctors WHERE id = ? AND tenant_id = ?'
      ).bind(doctorId, tenantId).first<{ id: number; name: string; user_id: number | null }>();

      if (!doctor) {
        return c.json({ error: 'Doctor profile not found in your hospital' }, 404);
      }
      if (doctor.user_id) {
        return c.json({ error: 'This doctor already has a linked user account' }, 409);
      }
      doctorName = doctor.name;
    }

    const token = generateInviteToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = expiresIn7Days();

    const result = await db.$client.prepare(
      'INSERT INTO invitations (tenant_id, email, role, token, invited_by, expires_at, doctor_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(tenantId, email, normalizeRole(role), tokenHash, callerId ?? 0, expiresAt, doctorId ?? null).run();

    // Get tenant slug for building the link
    const tenant = await db.$client.prepare(
      'SELECT subdomain, name FROM tenants WHERE id = ?'
    ).bind(tenantId).first<{ subdomain: string; name: string }>();

    const slug = tenant?.subdomain ?? 'hospital';
    const hospitalName = tenant?.name ?? 'HMS';

    const inviteLink = buildInvitePath(slug, token);
    const inviteUrl = buildAbsoluteInviteUrl(c.env.HMS_APP_URL ?? new URL(c.req.url).origin, inviteLink);

    await createAuditLog(c.env, tenantId, callerId ?? 0, 'CREATE', 'invitations',
      result.meta.last_row_id as number, null, {
        email,
        role: normalizedInviteRole,
        doctorId: doctorId ?? null,
        doctorName,
      },
      c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for') ?? undefined,
      c.req.header('user-agent') ?? undefined,
    );

    const inviter = await db.$client.prepare('SELECT name FROM users WHERE id = ? AND tenant_id = ?')
      .bind(callerId ?? 0, tenantId).first<{ name: string }>();
    const emailTemplate = EmailTemplates.staffInvite({
      inviteeName: doctorName ?? undefined,
      inviterName: inviter?.name ?? 'Hospital Admin',
      role: normalizeRole(role),
      hospitalName,
      inviteUrl,
    });
    const emailResult = await sendEmail(c.env, { to: email, ...emailTemplate });

    return c.json({
      message: 'Invitation created',
      invite: { email, role: normalizeRole(role), doctorId: doctorId ?? null, doctorName, expiresAt, inviteLink, emailSent: emailResult.success, emailError: emailResult.success ? undefined : emailResult.error },
    }, 201);
  } catch (error) {
    console.error('Invitation error:', error);
    return c.json({ error: 'Failed to create invitation' }, 500);
  }
});

// ─── GET /api/invitations — List invitations (staff:write) ────
invitationRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  try {
    const { results } = await db.$client.prepare(
      `SELECT i.id, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at, i.created_at,
              i.doctor_id, d.name AS doctor_name,
              u.name AS invited_by_name
       FROM invitations i
       LEFT JOIN users u ON u.id = i.invited_by
       LEFT JOIN doctors d ON d.id = i.doctor_id AND d.tenant_id = i.tenant_id
       WHERE i.tenant_id = ?
       ORDER BY i.created_at DESC
       LIMIT 100`
    ).bind(tenantId).all();

    const now = new Date();
    const invitations = (results as Array<Record<string, unknown>>).map((row) => {
      const { token: _storedToken, ...safeRow } = row;
      const status = row.accepted_at
        ? 'accepted'
        : row.revoked_at
          ? 'revoked'
          : new Date(row.expires_at as string) < now
            ? 'expired'
            : 'pending';
      return { ...safeRow, status };
    });

    return c.json({ invitations });
  } catch (error) {
    return c.json({ error: 'Failed to fetch invitations' }, 500);
  }
});

// ─── DELETE /api/invitations/:id — Revoke pending invitation ─────────
invitationRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const callerId = requireUserId(c);

  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid invitation id' }, 400);
  }

  try {
    const invite = await db.$client.prepare(
      'SELECT id, email, role, accepted_at, revoked_at, expires_at FROM invitations WHERE id = ? AND tenant_id = ?'
    ).bind(id, tenantId).first<{ id: number; email: string; role: string; accepted_at: string | null; revoked_at: string | null; expires_at: string }>();

    if (!invite) return c.json({ error: 'Invitation not found' }, 404);
    if (invite.accepted_at) return c.json({ error: 'Cannot revoke an accepted invitation' }, 409);
    if (invite.revoked_at) return c.json({ error: 'Invitation is already revoked' }, 409);

    await db.$client.prepare(
      `UPDATE invitations SET revoked_at = datetime('now') WHERE id = ? AND tenant_id = ?`
    ).bind(id, tenantId).run();

    await createAuditLog(c.env, tenantId, callerId ?? 0, 'UPDATE', 'invitations', id,
      { revoked_at: null }, { revoked_at: new Date().toISOString() },
      c.req.header('CF-Connecting-IP') ?? undefined,
      c.req.header('user-agent') ?? undefined,
    );

    return c.json({ message: 'Invitation revoked' });
  } catch (error) {
    console.error('Revoke invitation error:', error);
    return c.json({ error: 'Failed to revoke invitation' }, 500);
  }
});

// ─── POST /api/invitations/:id/resend — Generate new token, mark old revoked ──
invitationRoutes.post('/:id/resend', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const callerId = requireUserId(c);

  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid invitation id' }, 400);
  }

  try {
    const invite = await db.$client.prepare(
      'SELECT id, email, role, doctor_id, staff_id, accepted_at, revoked_at FROM invitations WHERE id = ? AND tenant_id = ?'
    ).bind(id, tenantId).first<{ id: number; email: string; role: string; doctor_id: number | null; staff_id: number | null; accepted_at: string | null; revoked_at: string | null }>();

    if (!invite) return c.json({ error: 'Invitation not found' }, 404);
    if (invite.accepted_at) return c.json({ error: 'Cannot resend an accepted invitation' }, 409);

    // Mark old as revoked and insert new
    const newToken = generateInviteToken();
    const newTokenHash = await sha256Hex(newToken);
    const expiresAt = expiresIn7Days();

    await db.$client.batch([
      db.$client.prepare(
        `UPDATE invitations SET revoked_at = datetime('now') WHERE id = ? AND tenant_id = ?`
      ).bind(id, tenantId),
      db.$client.prepare(
        `INSERT INTO invitations (tenant_id, email, role, token, invited_by, expires_at, doctor_id, staff_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(tenantId, invite.email, normalizeRole(invite.role), newTokenHash, callerId ?? 0, expiresAt, invite.doctor_id, invite.staff_id),
    ]);

    const tenant = await db.$client.prepare(
      'SELECT subdomain, name FROM tenants WHERE id = ?'
    ).bind(tenantId).first<{ subdomain: string; name: string }>();

    const slug = tenant?.subdomain ?? 'hospital';
    const inviteLink = buildInvitePath(slug, newToken);
    const inviteUrl = buildAbsoluteInviteUrl(c.env.HMS_APP_URL ?? new URL(c.req.url).origin, inviteLink);

    await createAuditLog(c.env, tenantId, callerId ?? 0, 'UPDATE', 'invitations', id,
      { action: 'resend', old_token_revoked: true },
      { action: 'resend', new_expires_at: expiresAt },
      c.req.header('CF-Connecting-IP') ?? undefined,
      c.req.header('user-agent') ?? undefined,
    );

    const inviter = await db.$client.prepare('SELECT name FROM users WHERE id = ? AND tenant_id = ?')
      .bind(callerId ?? 0, tenantId).first<{ name: string }>();
    const emailTemplate = EmailTemplates.staffInvite({
      inviterName: inviter?.name ?? 'Hospital Admin',
      role: normalizeRole(invite.role),
      hospitalName: tenant?.name ?? 'HMS',
      inviteUrl,
    });
    const emailResult = await sendEmail(c.env, { to: invite.email, ...emailTemplate });

    return c.json({ message: 'Invitation resent', inviteLink, expiresAt, emailSent: emailResult.success, emailError: emailResult.success ? undefined : emailResult.error });
  } catch (error) {
    console.error('Resend invitation error:', error);
    return c.json({ error: 'Failed to resend invitation' }, 500);
  }
});

export default invitationRoutes;
