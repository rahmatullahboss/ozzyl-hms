import { describe, expect, it } from 'vitest';

describe('PatientDuplicates', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PatientDuplicates');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
