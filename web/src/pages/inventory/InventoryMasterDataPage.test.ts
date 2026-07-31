import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('InventoryMasterDataPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./InventoryMasterDataPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('keeps the starter supplier loader wired to the inventory vendor seed endpoint', () => {
    const source = readFileSync('src/pages/inventory/InventoryMasterDataPage.tsx', 'utf8');

    expect(source).toContain('/api/inventory/vendors/defaults/seed');
    expect(source).toContain('inventory.masterData.vendor.loadDefaults');
    expect(source).toContain('inventory.masterData.vendor.defaultsLoaded');
  });
});
