import type { MiddlewareHandler } from 'hono';
import { verify, sign } from 'hono/jwt';
import { getCookie } from 'hono/cookie';
import type { Env, Variables } from '../types';
import { normalizeRole } from '../lib/authz';
import { buildTokenBlacklistKey } from '../lib/token-blacklist';
import { enforceMvpFeatureGate } from '../lib/mvp-feature-gates';
import { enforceMvpRoutePermission } from '../lib/mvp-route-permissions';
import { resolveCurrentTenantUserState } from '../lib/user-auth-state';

export interface JWTPayload {
  userId: string;
  role: string;
  tenantId?: string;
  permissions: string[];
  isImpersonation?: boolean;
  impersonatedByUserId?: string;
  impersonationReason?: string;
  impersonationSessionId?: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: Variables;
};

/**
 * Paths that are explicitly allowed to skip JWT authentication.
 *
 * SECURITY (P0-01): the previous implementation used `path.startsWith('/api/auth/')`
 * which unintentionally let `/api/auth/register` (per-tenant admin user
 * creation) bypass authentication. That left the route reachable without
 * any JWT, so anyone could call the admin-user-creation endpoint.
 *
 * This list is intentionally narrow — only paths that MUST be reachable
 * before a JWT exists (login, logout, refresh, email verification, and the
 * tenant-agnostic direct-login flow). All other `/api/auth/*` paths,
 * including `/api/auth/register`, fall through to the normal auth check.
 */
const PUBLIC_AUTH_PATH_PREFIXES: readonly string[] = [
  '/api/auth/login',
  '/api/auth/login-direct',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/auth/verify-email',
];

/**
 * Admin auth paths that are intentionally reachable WITHOUT an
 * Authorization header so the SPA can recover its super-admin session
 * after a hard reload from the HttpOnly `admin_token` cookie. The
 * middleware cookie path (see below) accepts the cookie on these
 * routes; everything else under /api/admin/ still requires a valid
 * bearer token.
 */
const PUBLIC_ADMIN_AUTH_PATHS: readonly string[] = [
  '/api/admin/refresh',
];

function isPublicAdminAuthPath(path: string): boolean {
  return PUBLIC_ADMIN_AUTH_PATHS.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

function isPublicAuthPath(path: string): boolean {
  return PUBLIC_AUTH_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * Whether `/api/auth/register` (per-tenant admin user creation) requires
 * authentication. Defaults to `true` — the route must be reached only by
 * an authenticated `hospital_admin`.
 *
 * To temporarily allow unauthenticated registration in a development
 * environment, set the `HMS_ALLOW_ANON_REGISTER=1` env var. The override
 * is logged at startup and at every unauthenticated register call so the
 * weakening is visible in logs.
 */
export const registerRequiresAuth: boolean = true;

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const rawUrl = c.req.url;
  const path = c.req.path;
  // Public routes — skip token check
  if (
    isPublicAuthPath(path) ||
    isPublicAdminAuthPath(path) ||
    path.startsWith('/api/patient-portal/') ||
    rawUrl.includes('/patient-portal/request-login') ||
    rawUrl.includes('/patient-portal/verify-email') ||
    rawUrl.includes('/patient-portal/register')
  ) {
    await next();
    return;
  }

  const authHeader = c.req.header('Authorization');
  let token: string | undefined;

  // Token resolution order (admin paths):
  //   1. admin_token cookie (XSS-safe, set on /api/admin/login)
  //   2. Authorization: Bearer header (backward compat for existing clients)
  // The cookie wins when both are present — defends against XSS that injects
  // a header, since XSS cannot read a httpOnly cookie.
  if (path.startsWith('/api/admin/')) {
    token = getCookie(c, 'admin_token') ?? undefined;
    if (!token && authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  } else if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (path.startsWith('/api/global-health/')) {
    token = getCookie(c, 'phr_token') ?? undefined;
  } else {
    // WebSocket connections can't send custom headers.
    // Accept token via query param for WebSocket-style paths.
    // NOTE: we also check Upgrade header, but Cloudflare's asset
    // pipeline may strip it before the worker sees the request.
    const queryToken = c.req.query('token');
    const isWsPath = c.req.path.endsWith('/ws');
    const upgradeHeader = c.req.header('Upgrade')?.toLowerCase();
    const isWsUpgrade = upgradeHeader === 'websocket';
    if (queryToken && (isWsUpgrade || isWsPath)) {
      token = queryToken;
    }
  }

  if (!token) {
    return c.json({ error: 'No token provided' }, 401);
  }

  const secret = c.env.JWT_SECRET;

  if (!secret) {
    console.error('JWT_SECRET environment variable is not set.');
    return c.json({ error: 'Server configuration error' }, 500);
  }

  try {
    // Check token blacklist (for logout)
    try {
      const isBlacklisted = await c.env.KV.get(await buildTokenBlacklistKey(token));
      if (isBlacklisted) {
        return c.json({ error: 'Token has been revoked' }, 401);
      }
    } catch (kvError) {
      // Fail closed: if we can't check the blacklist, reject the request
      // Better to deny a valid token than allow a revoked one
      console.error('Token blacklist KV check failed:', kvError);
      return c.json({ error: 'Authentication service unavailable' }, 503);
    }

    // Use hono/jwt verify — fully edge-runtime compatible (no Node.js crypto)
    const decoded = (await verify(token, secret, 'HS256')) as unknown as JWTPayload;
    const tokenRole = normalizeRole(decoded.role) || decoded.role;

    c.set('userId', decoded.userId);
    // 🛡️ Cross-validate: JWT tenant must match middleware-resolved tenant
    // Prevents cross-tenant access via crafted/stolen JWT
    const middlewareTenant = c.get('tenantId');
    if (middlewareTenant) {
      // Tenant middleware set a tenant — JWT MUST have a matching tenantId
      if (!decoded.tenantId) {
        return c.json({ error: 'Token missing tenant context' }, 401);
      }
      if (String(decoded.tenantId) !== String(middlewareTenant)) {
        return c.json({ error: 'Token tenant mismatch' }, 403);
      }
    }
    if (decoded.tenantId) {
      c.set('tenantId', decoded.tenantId);
    }

    let effectiveRole = tokenRole;
    const tenantId = c.get('tenantId');
    const shouldResolveCurrentUser = Boolean(
      c.env.DB && tenantId && decoded.userId && !['super_admin', 'patient'].includes(tokenRole),
    );
    if (shouldResolveCurrentUser) {
      try {
        const currentUser = await resolveCurrentTenantUserState(
          c.env.DB,
          c.env.KV,
          String(tenantId),
          String(decoded.userId),
        );
        if (!currentUser) {
          return c.json({ error: 'User account no longer exists in this hospital' }, 401);
        }
        if (!currentUser.isActive) {
          return c.json({ error: 'User account is inactive or deactivated' }, 401);
        }
        effectiveRole = currentUser.role;
      } catch (stateError) {
        console.error('Current user authorization state check failed:', stateError);
        return c.json({ error: 'Authentication service unavailable' }, 503);
      }
    }
    c.set('role', effectiveRole);

    enforceMvpFeatureGate({
      env: c.env as unknown as Record<string, unknown>,
      path,
    });

    await enforceMvpRoutePermission({
      db: c.env.DB,
      kv: c.env.KV,
      tenantId,
      userId: decoded.userId,
      role: effectiveRole,
      path,
      method: c.req.method,
    });

    await next();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('expired')) {
      return c.json({ error: 'Token has expired' }, 401);
    }
    if (error && typeof error === 'object' && 'status' in error) {
      throw error;
    }
    return c.json({ error: 'Invalid token' }, 401);
  }
};

/**
 * Generate a JWT token using hono/jwt (edge-runtime compatible).
 * Pass `c.env.JWT_SECRET` as the `secret` argument.
 * Returns a Promise — callers must await.
 */
export async function generateToken(
  payload: JWTPayload,
  secret: string,
  expiresInHours = 8
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      ...payload,
      iat: now,
      exp: now + expiresInHours * 3600,
    } as Record<string, unknown>,
    secret
  );
}

/**
 * Blacklist a token in KV so it cannot be used again.
 * @param ttl remaining validity in seconds
 */
export async function blacklistToken(
  token: string,
  kv: KVNamespace,
  ttl = 86400
): Promise<void> {
  await kv.put(await buildTokenBlacklistKey(token), '1', { expirationTtl: ttl });
}
