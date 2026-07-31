import { describe, expect, it } from 'vitest';

describe('PatientTimeline', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PatientTimeline');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
