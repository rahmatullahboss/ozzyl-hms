import { describe, expect, it } from 'vitest';

describe('PrintTemplateSettings', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PrintTemplateSettings');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
