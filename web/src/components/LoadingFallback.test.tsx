import { describe, expect, it } from 'vitest';

describe('LoadingFallback', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./LoadingFallback');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
