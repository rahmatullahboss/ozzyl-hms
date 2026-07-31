import { describe, expect, it } from 'vitest';

describe('ThemeContext', () => {
  it('exports a valid module', async () => {
    const mod = await import('./ThemeContext');
    const exports = Object.values(mod);
    expect(exports.length).toBeGreaterThan(0);
  });
});
