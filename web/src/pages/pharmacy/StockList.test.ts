import { describe, expect, it } from 'vitest';

describe('StockList', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./StockList');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
