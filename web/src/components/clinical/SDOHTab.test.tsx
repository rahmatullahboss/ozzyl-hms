import { describe, expect, it } from 'vitest';

describe('SDOHTab', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./SDOHTab');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });
});
