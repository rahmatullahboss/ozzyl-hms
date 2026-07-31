import { describe, expect, it } from 'vitest';

describe('GoodsReceiptForm', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./GoodsReceiptForm');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
