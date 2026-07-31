import { describe, expect, it } from 'vitest';

describe('DictationPage', () => {
  it('exports a default component', async () => {
    const mod = await import('./DictationPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
