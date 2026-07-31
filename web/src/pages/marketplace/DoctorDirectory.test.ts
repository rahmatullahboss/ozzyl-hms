import { describe, expect, it } from 'vitest';

describe('DoctorDirectory', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./DoctorDirectory');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
