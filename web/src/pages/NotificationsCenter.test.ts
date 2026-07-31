import { describe, expect, it } from 'vitest';

describe('NotificationsCenter', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./NotificationsCenter');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
