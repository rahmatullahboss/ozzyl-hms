import { describe, expect, it } from 'vitest';

describe('DoctorLogin', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./DoctorLogin');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
