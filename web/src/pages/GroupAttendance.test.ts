import { describe, expect, it } from 'vitest';

describe('GroupAttendance', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./GroupAttendance');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
