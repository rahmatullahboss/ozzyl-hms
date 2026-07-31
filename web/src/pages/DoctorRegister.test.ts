import { describe, expect, it } from 'vitest';

describe('DoctorRegister', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./DoctorRegister');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
