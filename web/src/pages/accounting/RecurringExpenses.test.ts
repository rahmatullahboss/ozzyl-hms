import { describe, expect, it } from 'vitest';

describe('RecurringExpenses', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./RecurringExpenses');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
