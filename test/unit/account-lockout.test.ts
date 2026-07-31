/**
 * Unit tests for the per-email account lockout helpers (P0-03).
 *
 * Verifies the new lockout helpers added to src/middleware/rate-limit.ts:
 *   • recordFailedLoginAttempt — atomic counter, locks at threshold
 *   • getAccountLockoutState — read-only, no side effects
 *   • clearAccountLockout — resets the counter
 *   • Fail-open behavior when KV is unavailable
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  recordFailedLoginAttempt,
  getAccountLockoutState,
  clearAccountLockout,
} from '../../src/middleware/rate-limit';

function makeMockKv() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string, _opts?: any) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    _store: store,
  };
}

describe('account lockout (P0-03)', () => {
  let kv: ReturnType<typeof makeMockKv>;

  beforeEach(() => {
    kv = makeMockKv();
  });

  it('records the first failure with attempts=1 and locked=false', async () => {
    const state = await recordFailedLoginAttempt(kv as any, 'user@example.com');
    expect(state.attempts).toBe(1);
    expect(state.locked).toBe(false);
    expect(state.retryAfterSeconds).toBe(0);
  });

  it('locks the account at the 5th attempt', async () => {
    let last;
    for (let i = 0; i < 4; i++) {
      last = await recordFailedLoginAttempt(kv as any, 'user@example.com');
      expect(last.locked).toBe(false);
    }
    last = await recordFailedLoginAttempt(kv as any, 'user@example.com');
    expect(last).toBeDefined();
    expect(last!.attempts).toBe(5);
    expect(last!.locked).toBe(true);
    expect(last!.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('uses a custom maxAttempts and window', async () => {
    const state = await recordFailedLoginAttempt(
      kv as any,
      'x@y.com',
      { maxAttempts: 2, windowSeconds: 60 },
    );
    expect(state.attempts).toBe(1);
    expect(state.locked).toBe(false);

    const state2 = await recordFailedLoginAttempt(
      kv as any,
      'x@y.com',
      { maxAttempts: 2, windowSeconds: 60 },
    );
    expect(state2.attempts).toBe(2);
    expect(state2.locked).toBe(true);
    expect(state2.retryAfterSeconds).toBe(60);
  });

  it('getAccountLockoutState returns locked=true without incrementing', async () => {
    for (let i = 0; i < 5; i++) {
      await recordFailedLoginAttempt(kv as any, 'lock@example.com');
    }

    const state = await getAccountLockoutState(kv as any, 'lock@example.com');
    expect(state.locked).toBe(true);

    // No extra write should have occurred from the read
    // (kv.put may have been called from recordFailedLoginAttempt, but not from getAccountLockoutState)
    const initialPutCount = kv.put.mock.calls.length;
    await getAccountLockoutState(kv as any, 'lock@example.com');
    expect(kv.put.mock.calls.length).toBe(initialPutCount);
  });

  it('getAccountLockoutState returns locked=false for an unknown identifier', async () => {
    const state = await getAccountLockoutState(kv as any, 'never@seen.com');
    expect(state.locked).toBe(false);
    expect(state.attempts).toBe(0);
  });

  it('clearAccountLockout removes the counter', async () => {
    for (let i = 0; i < 5; i++) {
      await recordFailedLoginAttempt(kv as any, 'clear@example.com');
    }
    expect((await getAccountLockoutState(kv as any, 'clear@example.com')).locked).toBe(true);

    await clearAccountLockout(kv as any, 'clear@example.com');
    expect((await getAccountLockoutState(kv as any, 'clear@example.com')).locked).toBe(false);
  });

  it('normalizes email casing and trims whitespace', async () => {
    await recordFailedLoginAttempt(kv as any, '  User@Example.COM  ');
    const state = await getAccountLockoutState(kv as any, 'user@example.com');
    expect(state.attempts).toBe(1);
  });

  it('isolates counters per identifier', async () => {
    await recordFailedLoginAttempt(kv as any, 'a@x.com');
    await recordFailedLoginAttempt(kv as any, 'a@x.com');
    await recordFailedLoginAttempt(kv as any, 'b@x.com');

    const a = await getAccountLockoutState(kv as any, 'a@x.com');
    const b = await getAccountLockoutState(kv as any, 'b@x.com');
    expect(a.attempts).toBe(2);
    expect(b.attempts).toBe(1);
  });

  it('fails open when KV is undefined', async () => {
    const state = await recordFailedLoginAttempt(undefined, 'a@x.com');
    expect(state.locked).toBe(false);
    expect(state.attempts).toBe(0);
  });

  it('fails open when KV.get throws', async () => {
    kv.get.mockRejectedValueOnce(new Error('KV outage'));
    const state = await recordFailedLoginAttempt(kv as any, 'a@x.com');
    expect(state.locked).toBe(false);
  });

  it('survives corrupt (non-numeric) counter values', async () => {
    kv._store.set('login_fail:v1:a@x.com', 'not-a-number');
    const state = await recordFailedLoginAttempt(kv as any, 'a@x.com');
    // Corrupt value is replaced with 1 on the next increment.
    expect(state.attempts).toBe(1);
    expect(state.locked).toBe(false);
  });
});
