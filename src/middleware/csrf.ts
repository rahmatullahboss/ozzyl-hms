import type { MiddlewareHandler } from 'hono';

/**
 * CSRF defense-in-depth: verify the Origin header on every state-changing
 * request to /api/admin/*.
 *
 * SameSite=Strict cookies already block most cross-site requests, but a
 * same-site subdomain (e.g., attacker.workers.dev) or a browser bug could
 * still leak the cookie. Checking the Origin closes that gap.
 *
 * Rules:
 *   - GET/HEAD/OPTIONS: skipped (safe methods; browsers don't always
 *     send Origin on GET; link previews and server polling must work)
 *   - /api/admin/login: skipped (the user is not authenticated yet; CSRF
 *     requires an existing session to attack)
 *   - All other state-changing methods:
 *       - Missing Origin → 403
 *       - Origin not in allowlist → 403
 *       - Origin matches APP_BASE_DOMAIN, the request's own Host (same-origin
 *         fallback), or localhost → allow
 *
 * Allowlist:
 *   - c.env.APP_BASE_DOMAIN (production; optional)
 *   - The request's own Host header (same-origin fallback; always allowed
 *     so we don't break the production app if APP_BASE_DOMAIN is unset)
 *   - http(s)://localhost[:port] (local dev)
 *   - http(s)://127.0.0.1[:port] (local dev)
 */

export type AppEnv = {
  Bindings: { APP_BASE_DOMAIN?: string; ENVIRONMENT?: string };
  Variables: Record<string, unknown>;
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOCAL_DEV_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];

/**
 * Build the Origin that would represent a same-origin request to this
 * server. Used as a fallback allowlist entry so the production app keeps
 * working when APP_BASE_DOMAIN is not configured.
 */
function sameOriginFromRequest(c: { req: { url?: string; header: (k: string) => string | undefined } }): string | null {
  const url = c.req.url;
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return null;
  }
}

export const csrfOriginGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method.toUpperCase();

  // Safe methods: no Origin check
  if (SAFE_METHODS.has(method)) {
    await next();
    return;
  }

  // The login endpoint is unauthenticated; CSRF requires a session.
  if (c.req.path === '/api/admin/login') {
    await next();
    return;
  }

  const origin = c.req.header('Origin');

  // Missing Origin on a state-changing method is a CSRF attempt. A
  // legitimate same-origin browser fetch always includes Origin; absence
  // means the request came from a context that isn't a browser (curl, a
  // server-side script) or from a cross-origin browser context that
  // stripped it. We reject.
  if (!origin) {
    return c.json(
      { error: 'Origin header required for state-changing requests' },
      403,
    );
  }

  // Build the allowlist
  const allowed = new Set<string>();
  const appBase = c.env.APP_BASE_DOMAIN?.trim();
  if (appBase) {
    allowed.add(appBase);
    // Also allow the http variant in dev
    if (c.env.ENVIRONMENT !== 'production' && appBase.startsWith('https://')) {
      allowed.add(appBase.replace('https://', 'http://'));
    }
  }
  // Same-origin fallback: the request's own URL origin is always allowed.
  // This keeps the production app working without needing APP_BASE_DOMAIN
  // to be configured, while still blocking cross-origin requests.
  const sameOrigin = sameOriginFromRequest(c);
  if (sameOrigin) {
    allowed.add(sameOrigin);
  }

  // Direct match
  if (allowed.has(origin)) {
    await next();
    return;
  }

  // Localhost / 127.0.0.1 are always allowed for local dev
  for (const pattern of LOCAL_DEV_ORIGINS) {
    if (pattern.test(origin)) {
      await next();
      return;
    }
  }

  return c.json({ error: 'Cross-origin request blocked' }, 403);
};
