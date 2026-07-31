import { describe, expect, it } from 'vitest';

describe('ErrorBoundary', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ErrorBoundary');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
