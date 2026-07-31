import { describe, expect, it } from 'vitest';

describe('ReportLabPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ReportLabPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
