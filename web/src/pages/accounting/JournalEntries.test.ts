import { describe, expect, it } from 'vitest';

describe('JournalEntries', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./JournalEntries');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
