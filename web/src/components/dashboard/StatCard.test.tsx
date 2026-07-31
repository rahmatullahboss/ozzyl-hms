import { describe, expect, it } from 'vitest';

describe('StatCard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./StatCard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
