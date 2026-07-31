import { describe, expect, it } from 'vitest';

describe('VaccinationDashboard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./VaccinationDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
