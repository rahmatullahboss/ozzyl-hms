import { describe, expect, it } from 'vitest';

describe('PurchaseOrderList', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PurchaseOrderList');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
