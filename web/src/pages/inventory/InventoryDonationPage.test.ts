import { describe, expect, it } from 'vitest';

describe('InventoryDonationPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./InventoryDonationPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
