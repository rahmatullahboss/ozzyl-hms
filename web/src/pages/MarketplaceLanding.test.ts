import { describe, expect, it } from 'vitest';

describe('MarketplaceLanding', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./MarketplaceLanding');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
