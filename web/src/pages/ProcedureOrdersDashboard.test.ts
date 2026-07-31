import { describe, expect, it } from 'vitest';

describe('ProcedureOrdersDashboard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ProcedureOrdersDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
