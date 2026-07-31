import { describe, expect, it } from 'vitest';

describe('ChartOfAccounts', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ChartOfAccounts');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
