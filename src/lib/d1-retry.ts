/**
 * Wraps a D1 read or write so a transient `VersionError` is retried.
 *
 * Cloudflare D1 occasionally throws:
 *   "VersionError: The requested version (1) is less than the existing version (2)."
 * when two requests land on the same storage snapshot in the same millisecond.
 * The error is harmless to retry — the next snapshot is almost always usable.
 *
 * Use this for any D1 op that runs in parallel with another D1 op (e.g. the
 * `/api/approvals` list and `/api/approvals/counts` endpoints both fire on the
 * admin pending-approvals page, so each individual D1 call inside them should
 * be wrapped).
 *
 * Behavior:
 *  - 4 attempts by default (1 initial + 3 retries)
 *  - 50ms / 100ms / 200ms exponential backoff with a 10% jitter
 *  - only retries when the error message contains "VersionError" — other
 *    errors (SQL syntax, FK violation, etc.) re-throw immediately so we don't
 *    mask real bugs as flakiness
 *  - if `label` is provided, the first failure is logged at warn level so we
 *    can observe retry pressure in the worker logs
 */
export interface D1WithRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  label?: string;
}

export function isD1VersionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && message.includes('VersionError');
}

export async function d1WithRetry<T>(
  op: () => Promise<T>,
  opts: D1WithRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 4);
  const baseDelayMs = Math.max(0, opts.baseDelayMs ?? 50);

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastError = err;
      const isLast = attempt === attempts - 1;
      if (!isD1VersionError(err) || isLast) {
        throw err;
      }
      const expDelay = baseDelayMs * Math.pow(2, attempt);
      const jitter = expDelay * 0.1 * Math.random();
      const delay = Math.round(expDelay + jitter);
      if (opts.label) {
        console.warn(
          `[d1-retry] ${opts.label}: VersionError on attempt ${attempt + 1}/${attempts}, retrying in ${delay}ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  // Unreachable: the loop either returns or throws, but TS needs an exit.
  throw lastError;
}
