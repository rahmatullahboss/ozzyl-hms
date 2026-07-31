import { describe, expect, it } from 'vitest';

describe('AssessmentsTab', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./AssessmentsTab');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
