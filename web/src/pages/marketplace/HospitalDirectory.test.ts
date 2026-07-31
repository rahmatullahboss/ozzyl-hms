import { describe, expect, it } from 'vitest';

describe('HospitalDirectory', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./HospitalDirectory');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
