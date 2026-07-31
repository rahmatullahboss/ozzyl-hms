import { describe, expect, it } from 'vitest';

describe('ReportDetailModal', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ReportDetailModal');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });
});
