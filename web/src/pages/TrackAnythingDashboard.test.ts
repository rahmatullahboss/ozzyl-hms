import { describe, expect, it } from 'vitest';

describe('TrackAnythingDashboard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./TrackAnythingDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
