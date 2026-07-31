import { describe, expect, it } from 'vitest';

describe('TriageChatbot', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./TriageChatbot');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
