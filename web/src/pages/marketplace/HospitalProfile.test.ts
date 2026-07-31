import { describe, expect, it } from 'vitest';

describe('HospitalProfile', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./HospitalProfile');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
