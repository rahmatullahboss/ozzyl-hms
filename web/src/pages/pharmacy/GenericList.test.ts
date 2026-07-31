import { describe, expect, it } from 'vitest';

describe('GenericList', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./GenericList');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
