import { describe, expect, it } from 'vitest';

describe('AmbulanceManagement', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./AmbulanceManagement');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
