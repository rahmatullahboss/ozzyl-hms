import { describe, expect, it } from 'vitest';

describe('ProfitLoss', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ProfitLoss');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
