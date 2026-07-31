import { describe, expect, it } from 'vitest';

describe('DispensaryStock', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./DispensaryStock');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
