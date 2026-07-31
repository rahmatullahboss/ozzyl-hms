import { describe, expect, it } from 'vitest';

describe('ClinicalAssessments', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ClinicalAssessments');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
