import { describe, expect, it } from 'vitest';

describe('InvoiceReceipt', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./InvoiceReceipt');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
