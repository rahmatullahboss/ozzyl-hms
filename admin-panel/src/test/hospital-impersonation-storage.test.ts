import { beforeEach, describe, expect, it } from 'vitest';
import { storeTenantImpersonationSession } from '../pages/HospitalDetail';

describe('admin-panel tenant impersonation storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores tenant impersonation token using the tenant app auth keys', () => {
    localStorage.setItem('hms_token', 'super-admin-token');

    storeTenantImpersonationSession({
      token: 'tenant-token',
      tenantName: 'Demo Hospital',
      tenantId: 42,
    });

    expect(localStorage.getItem('hms_super_token')).toBe('super-admin-token');
    expect(localStorage.getItem('hms_token')).toBe('tenant-token');
    expect(localStorage.getItem('hms_impersonating')).toBe(JSON.stringify({
      tenantName: 'Demo Hospital',
      tenantId: 42,
    }));
    expect(localStorage.getItem('admin_token')).toBeNull();
    expect(localStorage.getItem('admin_impersonating')).toBeNull();
  });
});
