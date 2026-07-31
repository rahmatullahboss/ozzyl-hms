import { describe, expect, it } from 'vitest';

describe('LabTestOrderForm', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./LabTestOrderForm');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
