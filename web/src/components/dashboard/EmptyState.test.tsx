import { describe, expect, it } from 'vitest';

describe('EmptyState', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./EmptyState');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
