import { describe, expect, it } from 'vitest';

describe('PatientCardScanner', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PatientCardScanner');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
