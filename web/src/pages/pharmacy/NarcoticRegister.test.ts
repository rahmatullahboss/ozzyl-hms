import { describe, expect, it } from 'vitest';

describe('NarcoticRegister', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./NarcoticRegister');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
