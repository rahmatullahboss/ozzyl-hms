import { describe, expect, it } from 'vitest';

describe('HistoryTab', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./HistoryTab');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
