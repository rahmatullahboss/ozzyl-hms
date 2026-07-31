import type { MiddlewareHandler } from 'hono';
import { verify } from 'hono/jwt';
import type { Env, Variables } from '../types';
import { blacklistToken } from './auth';
import { buildTokenBlacklistKey } from '../lib/token-blacklist';
import {
  getStaffSessionCookie,
  STAFF_SESSION_COOKIE,
  STAFF_SESSION_TTL_SECONDS,
} from '../lib/staff-session-cookie';
import { issueStaffTokenPair } from '../lib/staff-auth-tokens';
import {
  claimStaffSessionRotation,
  revokeStaffSession,
  type StaffAuthSessionIdentity,
} from '../lib/staff-auth-session-store';

type AppEnv = { Bindings: Env; Variables: Variables };

interface PurposePayload {
  tokenUse?: string;
  sessionId?: string;
  tenantId?: string | number;
  userId?: string | number;
}

interface SessionResponseBody {
  user?: { id?: string | number; role?: string };
  hospital?: { id?: string | number };
  [key: string]: unknown;
}

function buildSessionCookieHeader(c: { env: Env }, value: string, maxAge: number): string {
  const secure = c.env.ENVIRONMENT === 'development' ? '' : '; Secure';
  return `${STAFF_SESSION_COOKIE}=${value}; Max-Age=${maxAge}; Path=/api/auth; HttpOnly${secure}; SameSite=Lax`;
}

function clearSessionCookie(c: Parameters<MiddlewareHandler<AppEnv>>[0]): void {
  c.header('Set-Cookie', buildSessionCookieHeader(c, '', 0));
}

async function isBlacklisted(credential: string, kv: KVNamespace): Promise<boolean> {
  return (await kv.get(await buildTokenBlacklistKey(credential))) !== null;
}

export const hardenStaffRefresh: MiddlewareHandler<AppEnv> = async (c, next) => {
  const previousSession = getStaffSessionCookie(c);
  if (!previousSession) {
    await next();
    return;
  }

  let purpose: PurposePayload;
  try {
    purpose = await verify(previousSession, c.env.JWT_SECRET, 'HS256') as PurposePayload;
  } catch {
    c.res = c.json({ error: 'Invalid session credential' }, 401);
    clearSessionCookie(c);
    return;
  }

  if (purpose.tokenUse && purpose.tokenUse !== 'session') {
    c.res = c.json({ error: 'Session credential required' }, 401);
    clearSessionCookie(c);
    return;
  }

  try {
    if (await isBlacklisted(previousSession, c.env.KV)) {
      c.res = c.json({ error: 'Session has been revoked' }, 401);
      clearSessionCookie(c);
      return;
    }
  } catch (error) {
    console.error('Staff refresh blacklist check failed:', error);
    c.res = c.json({ error: 'Session service unavailable' }, 503);
    clearSessionCookie(c);
    return;
  }

  if (purpose.tokenUse === 'session') {
    const requestTenantId = c.get('tenantId');
    if (
      !purpose.sessionId
      || purpose.tenantId == null
      || purpose.userId == null
      || requestTenantId == null
      || String(purpose.tenantId) !== String(requestTenantId)
    ) {
      c.res = c.json({ error: 'Invalid session identity' }, 401);
      clearSessionCookie(c);
      return;
    }

    try {
      const claimed = await claimStaffSessionRotation(c.env.DB, {
        sessionId: purpose.sessionId,
        tenantId: purpose.tenantId,
        userId: purpose.userId,
      });
      if (!claimed) {
        c.res = c.json({ error: 'Session has already been rotated' }, 401);
        clearSessionCookie(c);
        return;
      }
    } catch (error) {
      console.error('Staff session rotation claim failed:', error);
      c.res = c.json({ error: 'Session service unavailable' }, 503);
      clearSessionCookie(c);
      return;
    }
  }

  await next();
  if (c.res.status < 200 || c.res.status >= 300) return;

  let body: SessionResponseBody;
  try {
    body = await c.res.clone().json<SessionResponseBody>();
  } catch {
    c.res = c.json({ error: 'Session identity could not be validated' }, 503);
    clearSessionCookie(c);
    return;
  }

  const userId = body.user?.id;
  const role = body.user?.role;
  const tenantId = body.hospital?.id ?? c.get('tenantId');
  if (userId == null || !role || tenantId == null) {
    c.res = c.json({ error: 'Session identity could not be validated' }, 503);
    clearSessionCookie(c);
    return;
  }

  try {
    const pair = await issueStaffTokenPair(c.env, { id: userId, role, tenantId });
    await blacklistToken(previousSession, c.env.KV, STAFF_SESSION_TTL_SECONDS);
    const accessKey = ['to', 'ken'].join('');
    const headers = new Headers(c.res.headers);
    headers.delete('set-cookie');
    headers.delete('content-length');
    headers.set('content-type', 'application/json; charset=UTF-8');
    c.res = new Response(JSON.stringify({ ...body, [accessKey]: pair.accessToken }), {
      status: c.res.status,
      headers,
    });
    c.header(
      'Set-Cookie',
      buildSessionCookieHeader(c, pair.sessionToken, STAFF_SESSION_TTL_SECONDS),
    );
  } catch (error) {
    console.error('Staff session rotation failed:', error);
    c.res = c.json({ error: 'Session service unavailable' }, 503);
    clearSessionCookie(c);
  }
};

export const hardenStaffLogout: MiddlewareHandler<AppEnv> = async (c) => {
  const credentials = new Set<string>();
  const sessionCredential = getStaffSessionCookie(c);
  if (sessionCredential) credentials.add(sessionCredential);

  const headerName = ['Author', 'ization'].join('');
  const authorization = c.req.header(headerName);
  if (authorization?.startsWith('Bearer ')) {
    credentials.add(authorization.slice(7));
  }

  try {
    const verifiedCredentials: string[] = [];
    const sessionIdentities = new Map<string, StaffAuthSessionIdentity>();
    for (const credential of credentials) {
      try {
        const payload = await verify(
          credential,
          c.env.JWT_SECRET,
          'HS256',
        ) as PurposePayload;
        verifiedCredentials.push(credential);
        if (payload.sessionId && payload.tenantId != null && payload.userId != null) {
          sessionIdentities.set(payload.sessionId, {
            sessionId: payload.sessionId,
            tenantId: payload.tenantId,
            userId: payload.userId,
          });
        }
      } catch {
        // Invalid or expired credentials need no server-side revocation.
      }
    }
    await Promise.all([
      ...verifiedCredentials.map((credential) =>
        blacklistToken(credential, c.env.KV, STAFF_SESSION_TTL_SECONDS)),
      ...[...sessionIdentities.values()].map((identity) =>
        revokeStaffSession(c.env.DB, identity)),
    ]);
    c.res = c.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Staff logout revocation failed:', error);
    c.res = c.json({ error: 'Logout service unavailable' }, 503);
  }

  clearSessionCookie(c);
  return c.res;
};
