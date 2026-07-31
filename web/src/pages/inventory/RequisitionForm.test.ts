import { describe, expect, it } from 'vitest';

describe('RequisitionForm', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./RequisitionForm');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
