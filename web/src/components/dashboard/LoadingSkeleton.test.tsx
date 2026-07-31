import { describe, expect, it } from 'vitest';

describe('LoadingSkeleton', () => {
  it('exports a valid React component as default', async () => {
    const mod = await import('./LoadingSkeleton');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('exports TableSkeleton as a named export', async () => {
    const mod = await import('./LoadingSkeleton');
    expect(mod.TableSkeleton).toBeDefined();
    expect(typeof mod.TableSkeleton).toBe('function');
  });

  it('exports CardSkeleton as a named export', async () => {
    const mod = await import('./LoadingSkeleton');
    expect(mod.CardSkeleton).toBeDefined();
    expect(typeof mod.CardSkeleton).toBe('function');
  });
});
