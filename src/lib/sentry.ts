/**
 * Sentry integration for Cloudflare Workers via toucan-js.
 *
 * Requires SENTRY_DSN secret: `wrangler secret put SENTRY_DSN`
 * Safely no-ops when SENTRY_DSN is not configured (local dev).
 */
import { Toucan } from 'toucan-js';
import type { Context } from 'hono';

type SentryBindings = {
  SENTRY_DSN?: string;
  ENVIRONMENT?: string;
};

function initSentry(c: Context<{ Bindings: SentryBindings }>): Toucan | null {
  const dsn = (c.env as SentryBindings).SENTRY_DSN;
  if (!dsn) return null;

  const sentry = new Toucan({
    dsn,
    context: (c.executionCtx as any) ?? { waitUntil: () => {} },
    request: c.req.raw,
    environment: (c.env as SentryBindings).ENVIRONMENT ?? 'production',
  });

  // Attach tenant context for easier production debugging
  try {
    const tenantId = (c as any).get?.('tenantId');
    const userId = (c as any).get?.('userId');
    if (tenantId) sentry.setTag('tenantId', String(tenantId));
    if (userId) sentry.setUser({ id: String(userId) });
  } catch {
    // Context may not be available early in middleware chain
  }

  return sentry;
}

/**
 * Capture an exception. Safe to call even if Sentry is not configured.
 */
export function captureException(
  c: Context<{ Bindings: SentryBindings }>,
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  try {
    const sentry = initSentry(c);
    if (!sentry) return;
    if (extra) sentry.setExtras(extra);
    sentry.captureException(err);
  } catch {
    // Never let Sentry crash the app
  }
}
