import { describe, expect, it } from 'vitest';

describe('PatientOnboardingPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PatientOnboardingPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
