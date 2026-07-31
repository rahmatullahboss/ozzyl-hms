import { describe, expect, it } from 'vitest';

describe('InventoryAdjustmentRequestPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./InventoryAdjustmentRequestPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
