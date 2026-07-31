import { describe, expect, it } from 'vitest';

describe('WriteOffList', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./WriteOffList');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
