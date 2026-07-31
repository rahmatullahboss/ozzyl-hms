import { describe, expect, it } from 'vitest';

describe('PatientChartPrint', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PatientChartPrint');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
