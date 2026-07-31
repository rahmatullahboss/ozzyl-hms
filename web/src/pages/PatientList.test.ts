import { describe, expect, it } from 'vitest';

describe('PatientList', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PatientList');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
