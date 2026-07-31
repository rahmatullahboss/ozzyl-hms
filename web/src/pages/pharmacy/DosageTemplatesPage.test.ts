import { describe, expect, it } from 'vitest';

describe('DosageTemplatesPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./DosageTemplatesPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
