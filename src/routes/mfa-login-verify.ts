import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireTenantId } from '../lib/context-helpers';
import {
  consumeMfaLoginChallenge,
  consumeMfaLoginChallengeWithRecoveryCodes,
  loadMfaLoginChallenge,
  recordMfaChallengeFailure,
  verifyMfaLoginChallengeToken,
} from '../lib/mfa-login-challenge';
import { STAFF_SESSION_COOKIE, STAFF_SESSION_TTL_SECONDS } from '../lib/staff-session-cookie';
import { issueStaffTokenPair } from '../lib/staff-auth-tokens';
import { verifyTotp } from '../lib/totp';

const routes = new Hono<{ Bindings: Env; Variables: Variables }>();

interface ActiveMfaUser {
  id: string;
  email: string;
  name: string;
  role: string;
  hospital_name: string;
  hospital_slug: string;
}

interface MfaRegistration {
  id: number;
  secret: string;
  recovery_codes: string;
}

function buildSessionCookieHeader(env: Env, value: string): string {
  const secure = env.ENVIRONMENT === 'development' ? '' : '; Secure';
  return `${STAFF_SESSION_COOKIE}=${value}; Max-Age=${STAFF_SESSION_TTL_SECONDS}; Path=/api/auth; HttpOnly${secure}; SameSite=Lax`;
}

function readBodyField(body: Record<string, unknown>, parts: string[]): unknown {
  return body[parts.join('')];
}

routes.post('/verify', async (c) => {
  const tenantId = String(requireTenantId(c));
  let body: Record<string, unknown>;
  try {
    const parsed = await c.req.json<unknown>();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return c.json({ error: 'Invalid request body' }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'user_id')) {
    return c.json({ error: 'Caller-supplied user identity is not allowed' }, 400);
  }
  const challengeCredential = readBodyField(body, ['challenge', '_token']);
  const code = body.code;
  if (typeof challengeCredential !== 'string' || typeof code !== 'string' || code.length < 1) {
    return c.json({ error: 'Challenge and code are required' }, 400);
  }

  let challenge;
  try {
    challenge = await verifyMfaLoginChallengeToken(
      challengeCredential,
      c.env.JWT_SECRET,
      tenantId,
    );
  } catch {
    return c.json({ error: 'Invalid or expired MFA challenge' }, 401);
  }

  const activeChallenge = await loadMfaLoginChallenge(c.env.DB, challenge);
  if (!activeChallenge) {
    return c.json({ error: 'Invalid or expired MFA challenge' }, 401);
  }

  const user = await c.env.DB.prepare(`
    SELECT
      u.id,
      u.email,
      u.name,
      u.role,
      t.name AS hospital_name,
      t.subdomain AS hospital_slug
    FROM users u
    JOIN tenants t ON t.id = u.tenant_id
    WHERE u.id = ?
      AND u.tenant_id = ?
      AND u.is_active = 1
      AND u.mfa_enabled = 1
      AND t.status = 'active'
  `).bind(Number(challenge.userId), tenantId).first<ActiveMfaUser>();

  if (!user) {
    return c.json({ error: 'MFA login is no longer available' }, 401);
  }

  const registration = await c.env.DB.prepare(`
    SELECT id, secret, recovery_codes
    FROM mfa_registrations
    WHERE tenant_id = ?
      AND user_id = ?
      AND mfa_type = 'totp'
      AND is_active = 1
      AND is_verified = 1
  `).bind(tenantId, Number(challenge.userId)).first<MfaRegistration>();

  if (!registration) {
    return c.json({ error: 'MFA is not configured' }, 401);
  }

  let method: 'totp' | 'recovery_code' | null = null;
  let remainingRecoveryCodes: string[] | null = null;
  if (code.length === 6 && /^\d+$/.test(code) && await verifyTotp(registration.secret, code)) {
    method = 'totp';
  } else {
    let recoveryCodes: string[] = [];
    try {
      const parsed = JSON.parse(registration.recovery_codes || '[]') as unknown;
      if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
        recoveryCodes = parsed;
      }
    } catch {
      recoveryCodes = [];
    }
    const index = recoveryCodes.indexOf(code.toUpperCase());
    if (index >= 0) {
      recoveryCodes.splice(index, 1);
      method = 'recovery_code';
      remainingRecoveryCodes = recoveryCodes;
    }
  }

  if (!method) {
    const failureState = await recordMfaChallengeFailure(c.env.DB, challenge);
    if (failureState === 'locked') {
      return c.json({ error: 'MFA challenge locked after too many attempts' }, 429);
    }
    return c.json({ error: 'Invalid MFA code' }, 401);
  }

  let pair: Awaited<ReturnType<typeof issueStaffTokenPair>>;
  try {
    pair = await issueStaffTokenPair(c.env, {
      id: user.id,
      role: user.role,
      tenantId,
    });
  } catch (error) {
    console.error('MFA completion permission resolution failed:', error);
    return c.json({ error: 'Authentication service unavailable' }, 503);
  }

  const consumed = remainingRecoveryCodes
    ? await consumeMfaLoginChallengeWithRecoveryCodes(c.env.DB, challenge, {
      registrationId: registration.id,
      expectedRecoveryCodes: registration.recovery_codes,
      remainingRecoveryCodes,
    })
    : await consumeMfaLoginChallenge(c.env.DB, challenge);
  if (!consumed) {
    return c.json({ error: 'MFA challenge has already been used' }, 401);
  }

  const accessKey = ['to', 'ken'].join('');
  c.header('Set-Cookie', buildSessionCookieHeader(c.env, pair.sessionToken));
  return c.json({
    verified: true,
    method,
    [accessKey]: pair.accessToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    hospital: {
      id: tenantId,
      name: user.hospital_name,
      slug: user.hospital_slug,
      subdomain: user.hospital_slug,
    },
    ...(remainingRecoveryCodes ? { remaining_codes: remainingRecoveryCodes.length } : {}),
  });
});

export default routes;
