import { describe, expect, it } from 'vitest';

describe('IPDReports', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./IPDReports');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
