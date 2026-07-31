import { describe, expect, it } from 'vitest';

describe('MedicalRecordsDashboard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./MedicalRecordsDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
