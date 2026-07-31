import { describe, expect, it } from 'vitest';

describe('EmergencyDashboard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./EmergencyDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
