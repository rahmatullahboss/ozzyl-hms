import { describe, expect, it } from 'vitest';

describe('HospitalSignup', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./HospitalSignup');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
