import { describe, expect, it } from 'vitest';

describe('InvoiceList', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./InvoiceList');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
