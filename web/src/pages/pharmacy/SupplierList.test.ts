import { describe, expect, it } from 'vitest';

describe('SupplierList', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./SupplierList');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
