import { describe, expect, it } from 'vitest';

describe('TelemedicineDashboard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./TelemedicineDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
