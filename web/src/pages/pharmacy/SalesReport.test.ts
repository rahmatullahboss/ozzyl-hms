import { describe, expect, it } from 'vitest';

describe('SalesReport', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./SalesReport');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
