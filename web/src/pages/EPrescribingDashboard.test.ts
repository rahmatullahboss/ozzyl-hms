import { describe, expect, it } from 'vitest';

describe('EPrescribingDashboard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./EPrescribingDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
