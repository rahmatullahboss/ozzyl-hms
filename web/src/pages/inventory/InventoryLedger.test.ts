import { describe, expect, it } from 'vitest';

describe('InventoryLedger', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./InventoryLedger');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
