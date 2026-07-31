import { describe, expect, it } from 'vitest';

describe('QualityKpiDashboard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./QualityKpiDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
