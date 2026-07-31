import { describe, expect, it } from 'vitest';

describe('PatientPortal', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PatientPortal');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
