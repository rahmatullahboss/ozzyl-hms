import { describe, expect, it } from 'vitest';

describe('AIAssistant', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./AIAssistant');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
