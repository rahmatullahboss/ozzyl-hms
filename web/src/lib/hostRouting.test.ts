import { describe, expect, it } from 'vitest';
import {
  getTenantSlugFromHost,
  isAdminHost,
  isPatientAppHost,
  isStaffAuthHost,
} from './hostRouting';

describe('host routing', () => {
  it('keeps known platform hosts out of tenant slug routing', () => {
    expect(getTenantSlugFromHost('hms.ozzyl.com')).toBe('');
    expect(getTenantSlugFromHost('admin.ozzyl.com')).toBe('');
    expect(getTenantSlugFromHost('app.ozzyl.com')).toBe('');
    expect(getTenantSlugFromHost('command-center.ozzyl.com')).toBe('');
  });

  it('resolves a valid tenant subdomain', () => {
    expect(getTenantSlugFromHost('city-hospital.ozzyl.com')).toBe('city-hospital');
  });

  it('preserves platform host classifications', () => {
    expect(isAdminHost('admin.ozzyl.com')).toBe(true);
    expect(isStaffAuthHost('hms.ozzyl.com')).toBe(true);
    expect(isStaffAuthHost('command-center.ozzyl.com')).toBe(true);
    expect(isPatientAppHost('app.ozzyl.com')).toBe(true);
  });
});
