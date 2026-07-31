import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import { EmailTemplates, sendEmail } from '../lib/email';
import { hashPassword } from '../lib/password';
import { isStrongPassword } from '../middleware/security';
import { clearAccountLockout } from '../middleware/rate-limit';
import { createAuditLog } from '../lib/accounting-helpers';

const staffPasswordResetRoutes = new Hono<{ Bindings: Env }>();
const forgotPasswordSchema = z.object({
  email: z.preprocess(
    (value) => typeof value === 'string' ? value.trim() : value,
    z.string().email(),
  ),
});
const resetPasswordSchema = z.object({
  password: z.string().min(8).refine(
    isStrongPassword,
    'Password must contain at least 1 uppercase letter, 1 lowercase letter, and 1 number',
  ),
});
const NEUTRAL_RESPONSE = 'If an active account exists for that email, a password reset link has been sent.';
const INVALID_LINK_RESPONSE = 'This password reset link is invalid or has expired.';
const RESET_EXPIRY_MS = 60 * 60 * 1000;

function generateResetToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function buildResetUrl(baseUrl: string, token: string): string {
  const url = new URL('/reset-password', baseUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

interface ActiveResetRecord {
  reset_id: number;
  user_id: number;
  tenant_id: number;
  email: string;
  name: string;
  hospital_name: string;
}

async function findActiveReset(env: Env, rawToken: string): Promise<ActiveResetRecord | null> {
  const tokenHash = await sha256Hex(rawToken);
  return env.DB.prepare(
    `SELECT spr.id AS reset_id, spr.user_id, spr.tenant_id,
            lower(u.email) AS email, u.name, t.name AS hospital_name
     FROM staff_password_resets spr
     JOIN users u ON u.id = spr.user_id AND u.tenant_id = spr.tenant_id
     JOIN tenants t ON t.id = spr.tenant_id
     WHERE spr.token_hash = ?
       AND spr.used_at IS NULL
       AND datetime(spr.expires_at) > datetime('now')
       AND u.is_active = 1
       AND t.status = 'active'
     LIMIT 1`,
  ).bind(tokenHash).first<ActiveResetRecord>();
}

staffPasswordResetRoutes.post('/forgot-password', zValidator('json', forgotPasswordSchema), async (c) => {
  const email = c.req.valid('json').email.trim().toLowerCase();

  try {
    const { results: accounts } = await c.env.DB.prepare(
      `SELECT u.id, lower(u.email) AS email, u.name, u.tenant_id, t.name AS hospital_name
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE lower(u.email) = ? AND u.is_active = 1 AND t.status = 'active'`,
    ).bind(email).all<{
      id: number;
      email: string;
      name: string;
      tenant_id: number;
      hospital_name: string;
    }>();

    for (const account of accounts) {
      const rawToken = generateResetToken();
      const tokenHash = await sha256Hex(rawToken);
      const expiresAt = new Date(Date.now() + RESET_EXPIRY_MS).toISOString();

      await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE staff_password_resets
           SET used_at = datetime('now')
           WHERE user_id = ? AND tenant_id = ? AND used_at IS NULL`,
        ).bind(account.id, account.tenant_id),
        c.env.DB.prepare(
          `INSERT INTO staff_password_resets (user_id, tenant_id, token_hash, expires_at)
           VALUES (?, ?, ?, ?)`,
        ).bind(account.id, account.tenant_id, tokenHash, expiresAt),
      ]);

      const resetUrl = buildResetUrl(c.env.HMS_APP_URL ?? new URL(c.req.url).origin, rawToken);
      const template = EmailTemplates.passwordReset({
        patientName: account.name,
        resetUrl,
        hospitalName: account.hospital_name,
      });
      await sendEmail(c.env, { to: account.email, ...template });
    }
  } catch (error) {
    console.error('Staff password reset request failed', error);
  }

  return c.json({ message: NEUTRAL_RESPONSE });
});

staffPasswordResetRoutes.get('/reset-password/:token', async (c) => {
  const reset = await findActiveReset(c.env, c.req.param('token'));
  if (!reset) {
    return c.json({ error: INVALID_LINK_RESPONSE }, 410);
  }

  const [localPart = '', domain = ''] = reset.email.split('@');
  const maskedEmail = `${localPart.slice(0, 1)}***@${domain}`;
  return c.json({
    valid: true,
    email: maskedEmail,
    hospitalName: reset.hospital_name,
  });
});

staffPasswordResetRoutes.post(
  '/reset-password/:token',
  zValidator('json', resetPasswordSchema),
  async (c) => {
    const reset = await findActiveReset(c.env, c.req.param('token'));
    if (!reset) {
      return c.json({ error: INVALID_LINK_RESPONSE }, 410);
    }

    const passwordHash = await hashPassword(c.req.valid('json').password);
    const claimedAt = new Date().toISOString();
    const batch = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE staff_password_resets
         SET used_at = ?
         WHERE id = ?
           AND user_id = ?
           AND tenant_id = ?
           AND used_at IS NULL
           AND datetime(expires_at) > datetime('now')
           AND EXISTS (
             SELECT 1 FROM users
             WHERE id = ? AND tenant_id = ? AND is_active = 1
           )`,
      ).bind(
        claimedAt,
        reset.reset_id,
        reset.user_id,
        reset.tenant_id,
        reset.user_id,
        reset.tenant_id,
      ),
      c.env.DB.prepare(
        `UPDATE users SET password_hash = ?,
           password_changed_at = datetime('now', '+6 hours'),
           login_attempts = 0,
           locked_until = NULL,
           updated_at = datetime('now', '+6 hours')
         WHERE id = ?
           AND tenant_id = ?
           AND is_active = 1
           AND EXISTS (
             SELECT 1 FROM staff_password_resets
             WHERE id = ?
               AND user_id = ?
               AND tenant_id = ?
               AND used_at = ?
           )`,
      ).bind(
        passwordHash,
        reset.user_id,
        reset.tenant_id,
        reset.reset_id,
        reset.user_id,
        reset.tenant_id,
        claimedAt,
      ),
      c.env.DB.prepare(
        `UPDATE staff_password_resets
         SET used_at = COALESCE(used_at, ?)
         WHERE user_id = ?
           AND tenant_id = ?
           AND id <> ?
           AND used_at IS NULL
           AND EXISTS (
             SELECT 1 FROM staff_password_resets claimed
             WHERE claimed.id = ? AND claimed.used_at = ?
           )`,
      ).bind(
        claimedAt,
        reset.user_id,
        reset.tenant_id,
        reset.reset_id,
        reset.reset_id,
        claimedAt,
      ),
    ]);

    if (batch[0]?.meta.changes !== 1 || batch[1]?.meta.changes !== 1) {
      return c.json({ error: INVALID_LINK_RESPONSE }, 410);
    }
    await clearAccountLockout(c.env.KV, reset.email);

    try {
      await createAuditLog(
        c.env,
        String(reset.tenant_id),
        String(reset.user_id),
        'PASSWORD_CHANGE',
        'users',
        reset.user_id,
        null,
        { method: 'self_service_reset' },
        c.req.header('CF-Connecting-IP') ?? undefined,
        c.req.header('user-agent') ?? undefined,
      );
    } catch {
      // Audit failure must not prevent a completed password reset.
    }

    return c.json({ message: 'Password updated successfully. You can now sign in.' });
  },
);

export default staffPasswordResetRoutes;
