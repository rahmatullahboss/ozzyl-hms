import { describe, expect, it } from 'vitest';

describe('CarePlansDashboard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./CarePlansDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
