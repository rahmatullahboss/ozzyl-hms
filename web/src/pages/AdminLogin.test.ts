import { describe, expect, it } from 'vitest';

describe('AdminLogin', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./AdminLogin');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
