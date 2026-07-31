import { describe, expect, it } from 'vitest';

describe('FiscalYearSettings', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./FiscalYearSettings');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
