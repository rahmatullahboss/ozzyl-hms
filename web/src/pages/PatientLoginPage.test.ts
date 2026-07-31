import { describe, expect, it } from 'vitest';

describe('PatientLoginPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PatientLoginPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
