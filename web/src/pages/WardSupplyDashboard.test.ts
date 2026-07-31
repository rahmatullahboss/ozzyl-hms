import { describe, expect, it } from 'vitest';

describe('WardSupplyDashboard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./WardSupplyDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
