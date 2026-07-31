import { describe, expect, it } from 'vitest';

describe('PurchaseOrderForm', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PurchaseOrderForm');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
