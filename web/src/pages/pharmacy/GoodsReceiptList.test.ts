import { describe, expect, it } from 'vitest';

describe('GoodsReceiptList', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./GoodsReceiptList');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
