import { describe, expect, it } from 'vitest';

describe('SafeChartFrame', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./SafeChartFrame');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
