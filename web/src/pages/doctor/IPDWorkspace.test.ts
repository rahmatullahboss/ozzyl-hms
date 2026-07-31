import { describe, expect, it } from 'vitest';

describe('IPDWorkspace', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./IPDWorkspace');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
