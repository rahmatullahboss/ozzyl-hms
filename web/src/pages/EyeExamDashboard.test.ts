import { describe, expect, it } from 'vitest';

describe('EyeExamDashboard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./EyeExamDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
