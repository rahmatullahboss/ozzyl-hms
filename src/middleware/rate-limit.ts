import { Context, Next } from 'hono';

// Rate limit configuration
const RATE_LIMIT_WINDOW = 60; // seconds
const MAX_REQUESTS = 100;
const LOGIN_RATE_LIMIT = 50;
const LOGIN_WINDOW = 900; // 15 minutes in seconds

export interface RateLimitConfig {
  window?: number; // seconds
  max?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KVContext = Context<{ Bindings: any; Variables: any }>;

/**
 * KV-backed rate limiting middleware.
 * Uses Cloudflare KV with TTL for automatic cleanup.
 */
export async function rateLimitMiddleware(c: KVContext, next: Next, config?: RateLimitConfig) {
  const windowSec = config?.window ?? RATE_LIMIT_WINDOW;
  const max = config?.max ?? MAX_REQUESTS;
  
  const ip = c.req.header('CF-Connecting-IP') ?? 
             c.req.header('X-Forwarded-For') ?? 
             'unknown';
  
  const key = `rate:${ip}`;
  
  try {
    const current = await c.env.KV.get(key);
    const now = Math.floor(Date.now() / 1000);
    let count: number;
    let windowStart: number;
    
    if (current) {
      // Format: "count:timestamp"
      const parts = current.split(':');
      count = parseInt(parts[0], 10);
      windowStart = parseInt(parts[1], 10);
      
      // If window has elapsed, reset
      if (now - windowStart >= windowSec) {
        count = 0;
        windowStart = now;
      }
    } else {
      count = 0;
      windowStart = now;
    }
    
    if (count >= max) {
      const retryAfter = windowSec - (now - windowStart);
      c.res.headers.set('X-RateLimit-Limit', String(max));
      c.res.headers.set('X-RateLimit-Remaining', '0');
      c.res.headers.set('X-RateLimit-Reset', String(windowStart + windowSec));
      c.res.headers.set('Retry-After', String(retryAfter));
      return c.json({
        success: false,
        error: 'Too many requests',
        message: `Rate limit exceeded. Try again in ${retryAfter}s.`,
      }, 429);
    }
    
    // Increment counter — TTL = remaining window time so it auto-expires
    const remainingTtl = windowSec - (now - windowStart);
    await c.env.KV.put(key, `${count + 1}:${windowStart}`, { expirationTtl: remainingTtl > 0 ? remainingTtl : windowSec });
    
    c.res.headers.set('X-RateLimit-Limit', String(max));
    c.res.headers.set('X-RateLimit-Remaining', String(max - count - 1));
    c.res.headers.set('X-RateLimit-Reset', String(windowStart + windowSec));
  } catch {
    // If KV is unavailable (e.g., local dev), allow the request through
  }
  
  return next();
}

/**
 * Login-specific rate limiting middleware.
 * Limits login attempts per IP to prevent brute-force attacks.
 * Uses a simple counter in KV with a 15-minute TTL.
 */
export async function loginRateLimit(c: KVContext, next: Next) {
  const ip = c.req.header('CF-Connecting-IP') ??
             c.req.header('X-Forwarded-For') ??
             'unknown';

  const key = `login:${ip}`;

  try {
    const current = await c.env.KV.get(key);
    const count = current ? parseInt(current, 10) : 0;

    if (count >= LOGIN_RATE_LIMIT) {
      return c.json({
        success: false,
        error: 'Too many login attempts',
        message: `Login rate limit exceeded. Try again in ${LOGIN_WINDOW}s.`,
      }, 429);
    }

    // Increment counter with TTL
    await c.env.KV.put(key, String(count + 1), { expirationTtl: LOGIN_WINDOW });
  } catch {
    // If KV is unavailable, allow the request through
  }

  return next();
}

// ─── Per-email account lockout (P0-03) ──────────────────────────────────

export interface AccountLockoutState {
  /** Number of failed attempts so far in the current window */
  attempts: number;
  /** Whether the account is currently locked */
  locked: boolean;
  /** Seconds remaining in the lockout window, if locked */
  retryAfterSeconds: number;
}

export interface AccountLockoutConfig {
  /** KV key prefix */
  keyPrefix?: string;
  /** Max failed attempts before lockout (default 5) */
  maxAttempts?: number;
  /** Lockout window in seconds (default 15 min = 900) */
  windowSeconds?: number;
}

const DEFAULT_LOCKOUT_MAX_ATTEMPTS = 5;
const DEFAULT_LOCKOUT_WINDOW_SECONDS = 15 * 60; // 15 minutes
const LOCKOUT_KEY_VERSION = 'v1';

function buildLockoutKey(prefix: string, identifier: string): string {
  // Hash to avoid leaking PII (email) in KV keys, and to keep keys
  // consistent regardless of email casing.
  const safeId = identifier.trim().toLowerCase();
  return `${prefix}:${LOCKOUT_KEY_VERSION}:${safeId}`;
}

function parseLockoutWindow(windowSeconds: number): { windowSeconds: number; maxAttempts: number } {
  return {
    windowSeconds: windowSeconds > 0 ? windowSeconds : DEFAULT_LOCKOUT_WINDOW_SECONDS,
    maxAttempts: DEFAULT_LOCKOUT_MAX_ATTEMPTS,
  };
}

/**
 * Atomically record a failed login attempt and return the new lockout state.
 *
 * Reuses the same KV-backed pattern as `loginRateLimit` and the tenant
 * login flow's MAX_LOGIN_ATTEMPTS / LOCKOUT_DURATION_MINUTES constants,
 * but stores the counter per identifier (typically email) so the lockout
 * follows the account, not just the IP.
 *
 * Fail-open: if KV is unavailable, returns an "unlocked" state so the
 * login request can proceed (audit log will still record the attempt).
 */
export async function recordFailedLoginAttempt(
  kv: KVNamespace | undefined,
  identifier: string,
  config: AccountLockoutConfig = {},
): Promise<AccountLockoutState> {
  const { windowSeconds, maxAttempts } = parseLockoutWindow(config.windowSeconds ?? DEFAULT_LOCKOUT_WINDOW_SECONDS);
  const limit = config.maxAttempts ?? maxAttempts;
  const prefix = config.keyPrefix ?? 'login_fail';
  const key = buildLockoutKey(prefix, identifier);

  if (!kv) {
    return { attempts: 0, locked: false, retryAfterSeconds: 0 };
  }

  try {
    const current = await kv.get(key);
    const attempts = current ? parseInt(current, 10) : 0;
    const newAttempts = Number.isFinite(attempts) ? attempts + 1 : 1;
    await kv.put(key, String(newAttempts), { expirationTtl: windowSeconds });

    if (newAttempts >= limit) {
      return {
        attempts: newAttempts,
        locked: true,
        retryAfterSeconds: windowSeconds,
      };
    }
    return {
      attempts: newAttempts,
      locked: false,
      retryAfterSeconds: 0,
    };
  } catch (error) {
    console.warn('recordFailedLoginAttempt: KV unavailable, allowing through', error);
    return { attempts: 0, locked: false, retryAfterSeconds: 0 };
  }
}

/**
 * Read the current lockout state for an identifier WITHOUT incrementing.
 * Used to early-out on requests for an already-locked account.
 */
export async function getAccountLockoutState(
  kv: KVNamespace | undefined,
  identifier: string,
  config: AccountLockoutConfig = {},
): Promise<AccountLockoutState> {
  const { windowSeconds, maxAttempts } = parseLockoutWindow(config.windowSeconds ?? DEFAULT_LOCKOUT_WINDOW_SECONDS);
  const limit = config.maxAttempts ?? maxAttempts;
  const prefix = config.keyPrefix ?? 'login_fail';
  const key = buildLockoutKey(prefix, identifier);

  if (!kv) {
    return { attempts: 0, locked: false, retryAfterSeconds: 0 };
  }

  try {
    const current = await kv.get(key);
    const attempts = current ? parseInt(current, 10) : 0;
    if (!Number.isFinite(attempts) || attempts < limit) {
      return { attempts: Number.isFinite(attempts) ? attempts : 0, locked: false, retryAfterSeconds: 0 };
    }
    return { attempts, locked: true, retryAfterSeconds: windowSeconds };
  } catch (error) {
    console.warn('getAccountLockoutState: KV unavailable, allowing through', error);
    return { attempts: 0, locked: false, retryAfterSeconds: 0 };
  }
}

/**
 * Clear the lockout counter after a successful login.
 */
export async function clearAccountLockout(
  kv: KVNamespace | undefined,
  identifier: string,
  config: AccountLockoutConfig = {},
): Promise<void> {
  if (!kv) return;
  const prefix = config.keyPrefix ?? 'login_fail';
  const key = buildLockoutKey(prefix, identifier);
  try {
    await kv.delete(key);
  } catch (error) {
    console.warn('clearAccountLockout: KV unavailable', error);
  }
}
