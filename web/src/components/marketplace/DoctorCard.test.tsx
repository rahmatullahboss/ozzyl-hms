import { describe, expect, it } from 'vitest';

describe('DoctorCard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./DoctorCard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
