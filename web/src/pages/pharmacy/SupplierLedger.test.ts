import { describe, expect, it } from 'vitest';

describe('SupplierLedger', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./SupplierLedger');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
