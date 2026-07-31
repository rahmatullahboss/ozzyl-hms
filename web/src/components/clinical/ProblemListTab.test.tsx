import { describe, expect, it } from 'vitest';

describe('ProblemListTab', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ProblemListTab');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
