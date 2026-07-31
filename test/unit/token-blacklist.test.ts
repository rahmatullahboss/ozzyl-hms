import { describe, expect, it } from 'vitest';
import { buildTokenBlacklistKey } from '../../src/lib/token-blacklist';

describe('token blacklist keys', () => {
  it('hashes long JWTs down to a KV-safe fixed-size key', async () => {
    const token = 'x'.repeat(900);
    const key = await buildTokenBlacklistKey(token);

    expect(key.startsWith('blacklist:')).toBe(true);
    expect(key.length).toBeLessThanOrEqual(512);
    expect(key).not.toContain(token);
  });

  it('is stable for the same token', async () => {
    const token = 'sample-jwt-token';
    const [first, second] = await Promise.all([
      buildTokenBlacklistKey(token),
      buildTokenBlacklistKey(token),
    ]);

    expect(first).toBe(second);
  });
});
