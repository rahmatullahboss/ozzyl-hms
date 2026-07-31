import { describe, expect, it } from 'vitest';

describe('IncomingReferralQueue', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./IncomingReferralQueue');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
