import { describe, expect, it } from 'vitest';

describe('InvoiceForm', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./InvoiceForm');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
