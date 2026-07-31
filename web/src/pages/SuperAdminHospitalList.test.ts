import { describe, expect, it } from 'vitest';

describe('SuperAdminHospitalList', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./SuperAdminHospitalList');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('keeps list impersonation inside SPA navigation so the memory token survives', async () => {
    const source = await import('./SuperAdminHospitalList?raw');

    expect(source.default).toContain('saveToken(data.token);');
    expect(source.default).toContain('navigate(data.redirectUrl);');
    expect(source.default).not.toContain('window.location.assign(data.redirectUrl)');
  });
});
