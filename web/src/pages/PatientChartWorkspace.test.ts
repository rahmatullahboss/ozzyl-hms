import { describe, expect, it } from 'vitest';

describe('PatientChartWorkspace', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PatientChartWorkspace');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
