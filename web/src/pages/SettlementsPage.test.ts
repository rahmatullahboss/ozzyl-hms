import { describe, expect, it } from 'vitest';

describe('SettlementsPage', () => {
  it('can be imported without error', async () => {
    const mod = await import('./SettlementsPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
