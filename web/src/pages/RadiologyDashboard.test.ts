import { describe, expect, it } from 'vitest';

describe('RadiologyDashboard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./RadiologyDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
