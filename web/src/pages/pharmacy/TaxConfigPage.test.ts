import { describe, expect, it } from 'vitest';

describe('TaxConfigPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./TaxConfigPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
