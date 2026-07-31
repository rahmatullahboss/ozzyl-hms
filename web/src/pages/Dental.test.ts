import { describe, expect, it } from 'vitest';

describe('Dental', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./Dental');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
