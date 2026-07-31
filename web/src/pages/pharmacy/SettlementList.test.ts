import { describe, expect, it } from 'vitest';

describe('SettlementList', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./SettlementList');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
