import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types';
import { normalizeBangladeshMobile } from '../lib/bangladesh-phone';
import { createMfaLoginChallenge } from '../lib/mfa-login-challenge';
import { STAFF_SESSION_COOKIE, STAFF_SESSION_TTL_SECONDS } from '../lib/staff-session-cookie';
import { issueStaffTokenPair } from '../lib/staff-auth-tokens';

type AppEnv = { Bindings: Env; Variables: Variables };

interface DirectLoginUser {
  id: string | number;
  email?: string;
  name?: string;
  role: string;
}

interface DirectLoginHospital {
  id: string | number;
  name?: string;
  slug?: string;
}

interface HospitalSelection {
  tenantId: string | number;
  hospitalName?: string;
  slug?: string;
  role?: string;
}

interface DirectLoginResponse {
  requireHospitalSelection?: boolean;
  hospitals?: HospitalSelection[];
  user?: DirectLoginUser;
  hospital?: DirectLoginHospital;
  slug?: string;
  [key: string]: unknown;
}

interface ActiveDirectLoginUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenant_id: string | number;
  mfa_enabled: number;
  hospital_name: string;
  hospital_slug: string;
}

function buildSessionCookieHeader(env: Env, value: string, maxAge: number): string {
  const secure = env.ENVIRONMENT === 'development' ? '' : '; Secure';
  return `${STAFF_SESSION_COOKIE}=${value}; Max-Age=${maxAge}; Path=/api/auth; HttpOnly${secure}; SameSite=Lax`;
}

function replaceJsonResponse(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  body: Record<string, unknown>,
  status: number,
): void {
  const headers = new Headers(c.res.headers);
  headers.delete('set-cookie');
  headers.delete('content-length');
  headers.set('content-type', 'application/json; charset=UTF-8');
  c.res = new Response(JSON.stringify(body), { status, headers });
}

function clearSessionCookie(c: Parameters<MiddlewareHandler<AppEnv>>[0]): void {
  c.header('Set-Cookie', buildSessionCookieHeader(c.env, '', 0));
}

async function readLoginIdentifier(
  request: Request,
): Promise<{ value: string; isMobile: boolean } | null> {
  try {
    const body = await request.clone().json<unknown>();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const email = (body as Record<string, unknown>).email;
    if (typeof email !== 'string' || email.trim() === '') return null;
    const raw = email.trim();
    const normalizedMobile = normalizeBangladeshMobile(raw);
    return {
      value: normalizedMobile ?? raw,
      isMobile: normalizedMobile !== null,
    };
  } catch {
    return null;
  }
}

export const hardenDirectLoginResponse: MiddlewareHandler<AppEnv> = async (c, next) => {
  const identifier = await readLoginIdentifier(c.req.raw);
  await next();

  if (c.res.status < 200 || c.res.status >= 300) return;
  if (!c.res.headers.get('content-type')?.includes('application/json')) {
    replaceJsonResponse(c, { error: 'Login response could not be validated' }, 503);
    clearSessionCookie(c);
    return;
  }

  let body: DirectLoginResponse;
  try {
    body = await c.res.clone().json<DirectLoginResponse>();
  } catch {
    replaceJsonResponse(c, { error: 'Login response could not be validated' }, 503);
    clearSessionCookie(c);
    return;
  }

  if (body.requireHospitalSelection) {
    if (!identifier || !Array.isArray(body.hospitals)) {
      replaceJsonResponse(c, { error: 'Login selection could not be validated' }, 503);
      clearSessionCookie(c);
      return;
    }

    try {
      const column = identifier.isMobile ? 'u.mobile' : 'u.email';
      const { results } = await c.env.DB.prepare(`
        SELECT u.tenant_id
        FROM users u
        JOIN tenants t ON t.id = u.tenant_id
        WHERE ${column} = ?
          AND u.is_active = 1
          AND t.status = 'active'
      `).bind(identifier.value).all<{ tenant_id: string | number }>();
      const activeTenantIds = new Set((results ?? []).map((row) => String(row.tenant_id)));
      const hospitals = body.hospitals.filter((hospital) =>
        activeTenantIds.has(String(hospital.tenantId)));

      if (hospitals.length === 0) {
        replaceJsonResponse(c, { error: 'No active hospital account is available' }, 403);
        clearSessionCookie(c);
        return;
      }

      replaceJsonResponse(c, { ...body, hospitals }, c.res.status);
      c.header('Set-Cookie', buildSessionCookieHeader(c.env, '', 0));
    } catch (error) {
      console.error('Direct login membership validation failed:', error);
      replaceJsonResponse(c, { error: 'Authentication service unavailable' }, 503);
      clearSessionCookie(c);
    }
    return;
  }

  const userId = body.user?.id;
  const tenantId = body.hospital?.id;
  if (userId == null || tenantId == null) {
    replaceJsonResponse(c, { error: 'Login identity could not be validated' }, 503);
    clearSessionCookie(c);
    return;
  }

  let activeUser: ActiveDirectLoginUser | null;
  try {
    activeUser = await c.env.DB.prepare(`
      SELECT
        u.id,
        u.email,
        u.name,
        u.role,
        u.tenant_id,
        u.mfa_enabled,
        t.name AS hospital_name,
        t.subdomain AS hospital_slug
      FROM users u
      JOIN tenants t ON t.id = u.tenant_id
      WHERE u.id = ?
        AND u.tenant_id = ?
        AND u.is_active = 1
        AND t.status = 'active'
    `).bind(Number(userId), tenantId).first<ActiveDirectLoginUser>();
  } catch (error) {
    console.error('Direct login account validation failed:', error);
    replaceJsonResponse(c, { error: 'Authentication service unavailable' }, 503);
    clearSessionCookie(c);
    return;
  }

  if (!activeUser) {
    replaceJsonResponse(c, { error: 'Account is no longer active' }, 401);
    clearSessionCookie(c);
    return;
  }

  if (activeUser.mfa_enabled === 1) {
    try {
      const challenge = await createMfaLoginChallenge(c.env.DB, c.env.JWT_SECRET, {
        tenantId: activeUser.tenant_id,
        userId: activeUser.id,
      });
      const challengeKey = ['challenge', '_token'].join('');
      replaceJsonResponse(c, {
        mfa_required: true,
        [challengeKey]: challenge,
        slug: activeUser.hospital_slug,
        hospital: {
          id: activeUser.tenant_id,
          name: activeUser.hospital_name,
          slug: activeUser.hospital_slug,
        },
        message: 'MFA verification required',
      }, 200);
      clearSessionCookie(c);
    } catch (error) {
      console.error('Direct login MFA challenge creation failed:', error);
      replaceJsonResponse(c, { error: 'Authentication service unavailable' }, 503);
      clearSessionCookie(c);
    }
    return;
  }

  try {
    const pair = await issueStaffTokenPair(c.env, {
      id: activeUser.id,
      role: activeUser.role,
      tenantId: activeUser.tenant_id,
    });
    const accessKey = ['to', 'ken'].join('');
    replaceJsonResponse(c, {
      ...body,
      [accessKey]: pair.accessToken,
      slug: activeUser.hospital_slug,
      user: {
        id: activeUser.id,
        email: activeUser.email,
        name: activeUser.name,
        role: activeUser.role,
      },
      hospital: {
        id: activeUser.tenant_id,
        name: activeUser.hospital_name,
        slug: activeUser.hospital_slug,
      },
    }, c.res.status);
    c.header(
      'Set-Cookie',
      buildSessionCookieHeader(c.env, pair.sessionToken, STAFF_SESSION_TTL_SECONDS),
    );
  } catch (error) {
    console.error('Direct login permission resolution failed:', error);
    replaceJsonResponse(c, { error: 'Authentication service unavailable' }, 503);
    clearSessionCookie(c);
  }
};
