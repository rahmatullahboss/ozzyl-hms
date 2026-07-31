import { describe, expect, it } from 'vitest';

describe('AllergiesPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./AllergiesPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
