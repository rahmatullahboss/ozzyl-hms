import { describe, expect, it } from 'vitest';

describe('DispatchList', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./DispatchList');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
