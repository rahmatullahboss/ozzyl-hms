import { describe, expect, it } from 'vitest';

describe('ReportPharmacyPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ReportPharmacyPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
