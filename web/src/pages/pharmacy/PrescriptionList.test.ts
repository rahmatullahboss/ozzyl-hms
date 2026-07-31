import { describe, expect, it } from 'vitest';

describe('PrescriptionList', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PrescriptionList');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
