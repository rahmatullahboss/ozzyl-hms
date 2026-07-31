import { describe, expect, it } from 'vitest';

describe('ImportExternalRecords', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ImportExternalRecords');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
