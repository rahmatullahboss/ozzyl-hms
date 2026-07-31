import { describe, expect, it } from 'vitest';

describe('ItemPriceHistory', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ItemPriceHistory');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
