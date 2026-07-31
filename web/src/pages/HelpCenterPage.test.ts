import { describe, expect, it } from 'vitest';

describe('HelpCenterPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./HelpCenterPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
