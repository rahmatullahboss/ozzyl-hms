import { describe, expect, it } from 'vitest';

describe('SuperAdminHospitalDetail', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./SuperAdminHospitalDetail');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('keeps impersonation inside SPA navigation so the memory token survives', async () => {
    const source = await import('./SuperAdminHospitalDetail?raw');

    expect(source.default).toContain('saveToken(res.token);');
    expect(source.default).toContain('navigate(res.redirectUrl);');
    expect(source.default).not.toContain('window.location.assign(res.redirectUrl)');
  });
});
