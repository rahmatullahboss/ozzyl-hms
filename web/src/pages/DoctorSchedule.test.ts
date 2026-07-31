import { describe, expect, it } from 'vitest';

describe('DoctorSchedule', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./DoctorSchedule');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
