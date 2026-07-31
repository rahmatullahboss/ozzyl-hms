import { describe, expect, it } from 'vitest';

describe('StockAdjustment', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./StockAdjustment');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
