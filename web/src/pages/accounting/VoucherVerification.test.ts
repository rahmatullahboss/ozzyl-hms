import { describe, expect, it } from 'vitest';

describe('VoucherVerification', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./VoucherVerification');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
