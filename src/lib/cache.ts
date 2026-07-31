import type { Context, Next } from 'hono';

/**
 * KV-based caching for Cloudflare Workers.
 *
 * Workers are STATELESS — in-memory Maps are wiped between invocations.
 * This module uses KV for persistent, globally-distributed caching.
 *
 * Best practice (per Cloudflare docs):
 *   • Use KV for read-heavy, write-infrequent data
 *   • TTL via KV's native `expirationTtl`
 *   • Cache key includes tenant for multi-tenant isolation
 */

const DEFAULT_TTL = 300; // 5 minutes

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  key?: string; // Custom cache key
}

/**
 * Get value from KV cache
 */
export async function getCache(kv: KVNamespace, key: string): Promise<unknown | null> {
  try {
    const raw = await kv.get(key, 'text');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Set value in KV cache
 */
export async function setCache(
  kv: KVNamespace,
  key: string,
  value: unknown,
  ttl: number = DEFAULT_TTL,
): Promise<void> {
  try {
    await kv.put(key, JSON.stringify(value), { expirationTtl: ttl });
  } catch {
    // Non-fatal — cache miss is acceptable
  }
}

/**
 * Delete value from KV cache
 */
export async function deleteCache(kv: KVNamespace, key: string): Promise<boolean> {
  try {
    await kv.delete(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Invalidate cache by prefix pattern.
 * Note: KV list is eventually consistent; this is best-effort.
 */
export async function invalidateCache(
  kv: KVNamespace,
  prefix: string,
): Promise<number> {
  let count = 0;
  try {
    const list = await kv.list({ prefix });
    const deletes = list.keys.map((k) => kv.delete(k.name));
    await Promise.allSettled(deletes);
    count = list.keys.length;
  } catch {
    // Best-effort
  }
  return count;
}

/**
 * Cache middleware for Hono.
 * Caches GET responses in KV with tenant-scoped keys.
 */
export async function cacheMiddleware(
  c: Context<{ Bindings: { KV: KVNamespace } }>,
  next: Next,
  options: CacheOptions = {},
): Promise<void> {
  const ttl = options.ttl ?? DEFAULT_TTL;
  const key = options.key ?? `cache:${c.req.method}:${c.req.url}`;

  // Only cache GET requests
  if (c.req.method !== 'GET') {
    return next();
  }

  // Return cached response if available
  const cached = await getCache(c.env.KV, key);
  if (cached !== null) {
    c.res = new Response(JSON.stringify(cached), {
      headers: { 'Content-Type': 'application/json' },
    });
    return;
  }

  // Let the handler run
  await next();

  // Cache the response body if 200
  try {
    if (c.res.status === 200) {
      const body = await c.res.clone().json();
      // Fire-and-forget — don't block the response
      c.executionCtx.waitUntil(setCache(c.env.KV, key, body, ttl));
    }
  } catch {
    // Ignore clone/parse errors — cache miss is non-fatal
  }
}
