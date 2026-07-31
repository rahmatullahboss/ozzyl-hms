import { describe, expect, it } from 'vitest';

describe('PatientBillingPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PatientBillingPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
