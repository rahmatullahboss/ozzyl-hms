import { describe, expect, it } from 'vitest';

describe('Camos', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./Camos');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
