import { describe, expect, it } from 'vitest';

describe('SuperAdminDashboard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./SuperAdminDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
