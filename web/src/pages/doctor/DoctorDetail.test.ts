import { describe, expect, it } from 'vitest';

describe('DoctorDetail', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./DoctorDetail');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
