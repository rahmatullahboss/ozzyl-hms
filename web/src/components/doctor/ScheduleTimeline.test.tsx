import { describe, expect, it } from 'vitest';

describe('ScheduleTimeline', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ScheduleTimeline');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });
});
