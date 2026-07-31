import { describe, expect, it } from 'vitest';

describe('ConsentManagement', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ConsentManagement');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
