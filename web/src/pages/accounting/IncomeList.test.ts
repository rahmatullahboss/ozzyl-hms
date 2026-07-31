import { describe, expect, it } from 'vitest';

describe('IncomeList', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./IncomeList');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
