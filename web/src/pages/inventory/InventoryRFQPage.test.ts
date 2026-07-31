import { describe, expect, it } from 'vitest';

describe('InventoryRFQPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./InventoryRFQPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
