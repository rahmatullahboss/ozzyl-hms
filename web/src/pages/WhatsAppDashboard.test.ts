import { describe, expect, it } from 'vitest';

describe('WhatsAppDashboard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./WhatsAppDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
