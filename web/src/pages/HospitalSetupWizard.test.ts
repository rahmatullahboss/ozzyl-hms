import { describe, expect, it } from 'vitest';

describe('HospitalSetupWizard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./HospitalSetupWizard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
