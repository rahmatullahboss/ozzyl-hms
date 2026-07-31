import { describe, expect, it } from 'vitest';

describe('Reports', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./Reports');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
