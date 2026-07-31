import { describe, expect, it } from 'vitest';

describe('ThemeToggle', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ThemeToggle');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
