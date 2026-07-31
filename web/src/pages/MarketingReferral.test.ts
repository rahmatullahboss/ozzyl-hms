import { describe, expect, it } from 'vitest';

describe('MarketingReferral', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./MarketingReferral');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
