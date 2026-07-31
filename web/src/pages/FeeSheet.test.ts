import { describe, expect, it } from 'vitest';

describe('FeeSheet', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./FeeSheet');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
