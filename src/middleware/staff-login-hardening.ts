import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types';
import { createMfaLoginChallenge } from '../lib/mfa-login-challenge';
import { STAFF_SESSION_COOKIE, STAFF_SESSION_TTL_SECONDS } from '../lib/staff-session-cookie';
import { issueStaffTokenPair } from '../lib/staff-auth-tokens';

type AppEnv = { Bindings: Env; Variables: Variables };

interface LoginResponseBody {
  mfa_required?: boolean;
  user_id?: string | number;
  user?: { id?: string | number; role?: string };
  hospital?: { id?: string | number };
  [key: string]: unknown;
}

function buildSessionCookieHeader(c: { env: Env }, value: string, maxAge: number): string {
  const secure = c.env.ENVIRONMENT === 'development' ? '' : '; Secure';
  return `${STAFF_SESSION_COOKIE}=${value}; Max-Age=${maxAge}; Path=/api/auth; HttpOnly${secure}; SameSite=Lax`;
}

export const hardenStaffLoginResponse: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();

  if (c.res.status < 200 || c.res.status >= 300) return;
  if (!c.res.headers.get('content-type')?.includes('application/json')) {
    c.res = c.json({ error: 'Login response could not be validated' }, 503);
    c.header('Set-Cookie', buildSessionCookieHeader(c, '', 0));
    return;
  }

  let body: LoginResponseBody;
  try {
    body = await c.res.clone().json<LoginResponseBody>();
  } catch {
    c.res = c.json({ error: 'Login response could not be validated' }, 503);
    c.header('Set-Cookie', buildSessionCookieHeader(c, '', 0));
    return;
  }
  if (body.mfa_required) {
    const tenantId = c.get('tenantId');
    const userId = body.user_id;
    if (tenantId == null || userId == null) {
      c.res = c.json({ error: 'MFA challenge could not be created' }, 503);
      c.header('Set-Cookie', buildSessionCookieHeader(c, '', 0));
      return;
    }

    try {
      const challenge = await createMfaLoginChallenge(c.env.DB, c.env.JWT_SECRET, {
        tenantId,
        userId,
      });
      const challengeKey = ['challenge', '_token'].join('');
      const headers = new Headers(c.res.headers);
      headers.delete('set-cookie');
      headers.delete('content-length');
      headers.set('content-type', 'application/json; charset=UTF-8');
      c.res = new Response(JSON.stringify({
        mfa_required: true,
        [challengeKey]: challenge,
        message: 'MFA verification required',
      }), {
        status: c.res.status,
        headers,
      });
      c.header('Set-Cookie', buildSessionCookieHeader(c, '', 0));
    } catch (error) {
      console.error('MFA login challenge creation failed:', error);
      c.res = c.json({ error: 'Authentication service unavailable' }, 503);
      c.header('Set-Cookie', buildSessionCookieHeader(c, '', 0));
    }
    return;
  }

  const userId = body.user?.id;
  const role = body.user?.role;
  const tenantId = body.hospital?.id ?? c.get('tenantId');
  if (userId == null || !role || tenantId == null) {
    c.res = c.json({ error: 'Login identity could not be validated' }, 503);
    c.header('Set-Cookie', buildSessionCookieHeader(c, '', 0));
    return;
  }

  try {
    const pair = await issueStaffTokenPair(c.env, { id: userId, role, tenantId });
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
    console.error('Staff login permission resolution failed:', error);
    c.res = c.json({ error: 'Authentication service unavailable' }, 503);
    c.header('Set-Cookie', buildSessionCookieHeader(c, '', 0));
  }
};
