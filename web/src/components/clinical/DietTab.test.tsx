import { describe, expect, it } from 'vitest';

describe('DietTab', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./DietTab');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
