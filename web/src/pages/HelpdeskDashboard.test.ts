import { describe, expect, it } from 'vitest';

describe('HelpdeskDashboard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./HelpdeskDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
