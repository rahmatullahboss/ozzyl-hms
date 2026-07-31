import { describe, expect, it } from 'vitest';

describe('PharmacyDashboard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PharmacyDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
