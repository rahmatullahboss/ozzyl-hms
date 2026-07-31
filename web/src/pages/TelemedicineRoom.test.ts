import { describe, expect, it } from 'vitest';

describe('TelemedicineRoom', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./TelemedicineRoom');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
