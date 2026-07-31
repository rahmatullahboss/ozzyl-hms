import { describe, expect, it } from 'vitest';

describe('ReceptionModals', () => {
  it('exports DeskStat as a valid React component', async () => {
    const mod = await import('./ReceptionModals');
    expect(mod.DeskStat).toBeDefined();
    expect(typeof mod.DeskStat).toBe('function');
  });

  it('exports Modal as a valid React component', async () => {
    const mod = await import('./ReceptionModals');
    expect(mod.Modal).toBeDefined();
    expect(typeof mod.Modal).toBe('function');
  });

  it('exports LabTestSelector as a valid React component', async () => {
    const mod = await import('./ReceptionModals');
    expect(mod.LabTestSelector).toBeDefined();
    expect(typeof mod.LabTestSelector).toBe('function');
  });
});
