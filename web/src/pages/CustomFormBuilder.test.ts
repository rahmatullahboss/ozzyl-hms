import { describe, expect, it } from 'vitest';

describe('CustomFormBuilder', () => {
  it('exports a default component', async () => {
    const mod = await import('./CustomFormBuilder');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
