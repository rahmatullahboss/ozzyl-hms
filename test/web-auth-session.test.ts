import { describe, expect, it } from 'vitest';
import { buildAuthenticatedRedirectPath } from '../web/src/lib/authSession';

describe('auth session redirect path', () => {
  it('builds slug-aware tenant dashboard paths', () => {
    expect(buildAuthenticatedRedirectPath('hospital_admin', 'demo', null)).toBe('/h/demo/dashboard');
    expect(buildAuthenticatedRedirectPath('doctor', 'demo', null)).toBe('/h/demo/doctor/dashboard');
    expect(buildAuthenticatedRedirectPath('nurse', 'demo', null)).toBe('/h/demo/nurse-station');
  });

  it('falls back to last remembered slug when current slug is missing', () => {
    expect(buildAuthenticatedRedirectPath('reception', null, 'city-hospital')).toBe('/h/city-hospital/reception/dashboard');
  });

  it('returns absolute routes for super admin without needing a slug', () => {
    expect(buildAuthenticatedRedirectPath('super_admin', null, null)).toBe('/super-admin/dashboard');
  });
});
