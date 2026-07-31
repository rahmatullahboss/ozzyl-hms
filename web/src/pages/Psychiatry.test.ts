import { describe, expect, it } from 'vitest';

describe('Psychiatry', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./Psychiatry');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
