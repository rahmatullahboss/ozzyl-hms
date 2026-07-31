import { describe, expect, it } from 'vitest';

describe('DeathRecords', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./DeathRecords');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
