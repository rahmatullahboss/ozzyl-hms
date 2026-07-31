import { describe, expect, it } from 'vitest';

describe('DataTable', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./DataTable');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBeOneOf(['function', 'object']);
  });
});
