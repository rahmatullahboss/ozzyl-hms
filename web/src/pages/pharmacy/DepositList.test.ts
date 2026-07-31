import { describe, expect, it } from 'vitest';

describe('DepositList', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./DepositList');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
