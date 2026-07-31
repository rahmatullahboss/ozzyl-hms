import { describe, expect, it } from 'vitest';

describe('PharmacyOverview', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PharmacyOverview');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
