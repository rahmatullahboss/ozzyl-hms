import { describe, expect, it } from 'vitest';

describe('DispatchForm', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./DispatchForm');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
