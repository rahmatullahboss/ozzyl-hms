import { describe, expect, it } from 'vitest';

describe('VitalsPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./VitalsPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
