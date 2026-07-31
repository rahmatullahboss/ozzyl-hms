import { describe, expect, it } from 'vitest';

describe('PaymentsPage', () => {
  it('can be imported without error', async () => {
    const mod = await import('./PaymentsPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
