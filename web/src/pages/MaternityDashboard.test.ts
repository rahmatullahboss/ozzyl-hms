import { describe, expect, it } from 'vitest';

describe('MaternityDashboard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./MaternityDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
