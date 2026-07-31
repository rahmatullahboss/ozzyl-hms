import { describe, expect, it } from 'vitest';

describe('MARTab', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./MARTab');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });
});
