import { describe, expect, it } from 'vitest';

describe('InventoryCountPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./InventoryCountPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
