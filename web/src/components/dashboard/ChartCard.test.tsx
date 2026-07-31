import { describe, expect, it } from 'vitest';

describe('ChartCard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ChartCard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
