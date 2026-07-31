import { describe, expect, it } from 'vitest';

describe('PatientSnapshot', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PatientSnapshot');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
