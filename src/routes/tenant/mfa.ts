/**
 * MFA/TOTP routes — setup, verify, manage
 *
 * TOTP implementation using Web Crypto API (no external deps).
 * Compatible with Google Authenticator, Authy, etc.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { generateToken } from '../../middleware/auth';
import { getPermissionsForRole, normalizeRole } from '../../lib/authz';

const mfaRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── TOTP Helpers (pure Web Crypto, no deps) ─────────────────────────────────

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function generateSecret(length = 20): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = '';
  for (const byte of bytes) {
    result += BASE32_CHARS[byte % 32];
  }
  return result;
}

function base32Decode(input: string): Uint8Array {
  const cleaned = input.replace(/=+$/, '').toUpperCase();
  const output: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of cleaned) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >> bits) & 0xff);
    }
  }
  return new Uint8Array(output);
}

async function generateTOTP(secret: string, time?: number): Promise<string> {
  const now = time ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / 30);

  const keyBytes = base32Decode(secret);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);

  const counterBuffer = new ArrayBuffer(8);
  const view = new DataView(counterBuffer);
  view.setUint32(4, counter, false);

  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBuffer));
  const offset = sig[sig.length - 1] & 0x0f;
  const code = ((sig[offset] & 0x7f) << 24 | sig[offset + 1] << 16 | sig[offset + 2] << 8 | sig[offset + 3]) % 1000000;

  return String(code).padStart(6, '0');
}

async function verifyTOTP(secret: string, token: string, window = 1): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  for (let i = -window; i <= window; i++) {
    const expected = await generateTOTP(secret, now + i * 30);
    if (expected === token) return true;
  }
  return false;
}

function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = new Uint8Array(5);
    crypto.getRandomValues(bytes);
    codes.push(Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase());
  }
  return codes;
}

function buildOtpauthUrl(secret: string, email: string, issuer = 'Ozzyl Health'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}

// ─── Setup TOTP ──────────────────────────────────────────────────────────────

// POST /api/mfa/setup — Generate new TOTP secret
mfaRoutes.post('/setup', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);

  // Check if already has MFA
  const existing = await db.$client.prepare(
    'SELECT id FROM mfa_registrations WHERE tenant_id = ? AND user_id = ? AND mfa_type = \'totp\' AND is_active = 1'
  ).bind(tenantId, userId).first();
  if (existing) throw new HTTPException(400, { message: 'MFA already configured. Disable first.' });

  // Get user email for QR label
  const user = await db.$client.prepare('SELECT email FROM users WHERE id = ? AND tenant_id = ?').bind(userId, tenantId).first<{ email: string }>();
  if (!user) throw new HTTPException(404, { message: 'User not found' });

  const secret = generateSecret();
  const recoveryCodes = generateRecoveryCodes();
  const otpauthUrl = buildOtpauthUrl(secret, user.email);

  // Store (not yet verified)
  await db.$client.prepare(`
    INSERT INTO mfa_registrations (tenant_id, user_id, mfa_type, secret, recovery_codes, is_verified)
    VALUES (?, ?, 'totp', ?, ?, 0)
    ON CONFLICT(tenant_id, user_id, mfa_type) DO UPDATE SET secret = ?, recovery_codes = ?, is_verified = 0, is_active = 1
  `).bind(tenantId, userId, secret, JSON.stringify(recoveryCodes), secret, JSON.stringify(recoveryCodes)).run();

  return c.json({
    secret,
    otpauth_url: otpauthUrl,
    recovery_codes: recoveryCodes,
    message: 'Scan the QR code with your authenticator app, then verify with a code.',
  });
});

// POST /api/mfa/verify-setup — Verify first TOTP code to activate MFA
mfaRoutes.post('/verify-setup', zValidator('json', z.object({
  code: z.string().length(6),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { code } = c.req.valid('json');
  const db = getDb(c.env.DB);

  const reg = await db.$client.prepare(
    'SELECT id, secret FROM mfa_registrations WHERE tenant_id = ? AND user_id = ? AND mfa_type = \'totp\' AND is_active = 1'
  ).bind(tenantId, userId).first<{ id: number; secret: string }>();
  if (!reg) throw new HTTPException(404, { message: 'No MFA setup found. Run /setup first.' });

  const valid = await verifyTOTP(reg.secret, code);
  if (!valid) throw new HTTPException(400, { message: 'Invalid code. Try again.' });

  // Mark as verified + enable MFA on user
  await db.$client.prepare('UPDATE mfa_registrations SET is_verified = 1 WHERE id = ?').bind(reg.id).run();
  await db.$client.prepare('UPDATE users SET mfa_enabled = 1 WHERE id = ? AND tenant_id = ?').bind(userId, tenantId).run();

  return c.json({ message: 'MFA enabled successfully' });
});

// ─── Verify TOTP (during login) ──────────────────────────────────────────────

// POST /api/mfa/verify — Verify TOTP or recovery code during login
mfaRoutes.post('/verify', zValidator('json', z.object({
  user_id: z.number().int().positive(),
  code: z.string().min(1),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { user_id, code } = c.req.valid('json');
  const db = getDb(c.env.DB);

  const reg = await db.$client.prepare(
    'SELECT id, secret, recovery_codes FROM mfa_registrations WHERE tenant_id = ? AND user_id = ? AND mfa_type = \'totp\' AND is_active = 1 AND is_verified = 1'
  ).bind(tenantId, user_id).first<{ id: number; secret: string; recovery_codes: string }>();
  if (!reg) throw new HTTPException(404, { message: 'MFA not configured for this user' });

  // Helper: issue JWT after successful MFA
  const issueToken = async (method: string, extra?: Record<string, unknown>) => {
    const user = await db.$client.prepare('SELECT id, email, name, role FROM users WHERE id = ? AND tenant_id = ?').bind(user_id, tenantId).first<{ id: string; email: string; name: string; role: string }>();
    if (!user) throw new HTTPException(404, { message: 'User not found' });
    const token = await generateToken({ userId: user.id, role: normalizeRole(user.role), tenantId, permissions: getPermissionsForRole(user.role) }, c.env.JWT_SECRET, 8);
    return c.json({ verified: true, method, token, user: { id: user.id, email: user.email, name: user.name, role: normalizeRole(user.role) }, ...extra });
  };

  // Try TOTP first
  if (code.length === 6 && /^\d+$/.test(code)) {
    const valid = await verifyTOTP(reg.secret, code);
    if (valid) return issueToken('totp');
  }

  // Try recovery code
  const codes: string[] = JSON.parse(reg.recovery_codes || '[]');
  const upperCode = code.toUpperCase();
  const idx = codes.indexOf(upperCode);
  if (idx !== -1) {
    codes.splice(idx, 1);
    await db.$client.prepare('UPDATE mfa_registrations SET recovery_codes = ? WHERE id = ?').bind(JSON.stringify(codes), reg.id).run();
    return issueToken('recovery_code', { remaining_codes: codes.length });
  }

  return c.json({ verified: false, error: 'Invalid code' }, 401);
});

// ─── Disable MFA ─────────────────────────────────────────────────────────────

mfaRoutes.post('/disable', zValidator('json', z.object({
  code: z.string().min(1),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { code } = c.req.valid('json');
  const db = getDb(c.env.DB);

  const reg = await db.$client.prepare(
    'SELECT id, secret FROM mfa_registrations WHERE tenant_id = ? AND user_id = ? AND mfa_type = \'totp\' AND is_active = 1 AND is_verified = 1'
  ).bind(tenantId, userId).first<{ id: number; secret: string }>();
  if (!reg) throw new HTTPException(404, { message: 'MFA not enabled' });

  const valid = await verifyTOTP(reg.secret, code);
  if (!valid) throw new HTTPException(400, { message: 'Invalid code. Cannot disable MFA.' });

  await db.$client.prepare('UPDATE mfa_registrations SET is_active = 0 WHERE id = ?').bind(reg.id).run();
  await db.$client.prepare('UPDATE users SET mfa_enabled = 0 WHERE id = ? AND tenant_id = ?').bind(userId, tenantId).run();

  return c.json({ message: 'MFA disabled' });
});

// ─── Status ──────────────────────────────────────────────────────────────────

mfaRoutes.get('/status', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);

  const reg = await db.$client.prepare(
    'SELECT id, mfa_type, is_verified, created_at FROM mfa_registrations WHERE tenant_id = ? AND user_id = ? AND is_active = 1'
  ).bind(tenantId, userId).first<{ id: number; mfa_type: string; is_verified: number; created_at: string }>();

  const user = await db.$client.prepare('SELECT mfa_enabled FROM users WHERE id = ? AND tenant_id = ?').bind(userId, tenantId).first<{ mfa_enabled: number }>();

  return c.json({
    mfa_enabled: !!(user?.mfa_enabled),
    mfa_type: reg?.mfa_type ?? null,
    is_verified: !!(reg?.is_verified),
    setup_at: reg?.created_at ?? null,
  });
});

// ─── Regenerate Recovery Codes ───────────────────────────────────────────────

mfaRoutes.post('/recovery-codes', zValidator('json', z.object({
  code: z.string().length(6),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { code } = c.req.valid('json');
  const db = getDb(c.env.DB);

  const reg = await db.$client.prepare(
    'SELECT id, secret FROM mfa_registrations WHERE tenant_id = ? AND user_id = ? AND mfa_type = \'totp\' AND is_active = 1 AND is_verified = 1'
  ).bind(tenantId, userId).first<{ id: number; secret: string }>();
  if (!reg) throw new HTTPException(404, { message: 'MFA not enabled' });

  const valid = await verifyTOTP(reg.secret, code);
  if (!valid) throw new HTTPException(400, { message: 'Invalid code' });

  const newCodes = generateRecoveryCodes();
  await db.$client.prepare('UPDATE mfa_registrations SET recovery_codes = ? WHERE id = ?').bind(JSON.stringify(newCodes), reg.id).run();

  return c.json({ recovery_codes: newCodes, message: 'New recovery codes generated. Save them securely.' });
});

export default mfaRoutes;
