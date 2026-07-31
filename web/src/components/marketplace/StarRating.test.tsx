import { describe, expect, it } from 'vitest';

describe('StarRating', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./StarRating');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
