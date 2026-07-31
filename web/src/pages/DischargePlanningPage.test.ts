import { describe, expect, it } from 'vitest';

describe('DischargePlanningPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./DischargePlanningPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
