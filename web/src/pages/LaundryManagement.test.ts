import { describe, expect, it } from 'vitest';

describe('LaundryManagement', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./LaundryManagement');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
