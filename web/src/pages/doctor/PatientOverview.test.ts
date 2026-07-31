import { describe, expect, it } from 'vitest';

describe('PatientOverview', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PatientOverview');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
