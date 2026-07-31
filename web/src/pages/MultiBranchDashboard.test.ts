import { describe, expect, it } from 'vitest';

describe('MultiBranchDashboard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./MultiBranchDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
