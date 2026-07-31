import { describe, expect, it } from 'vitest';
import { getPermissionsForRole, normalizeRole } from '../../packages/shared/src/authz';
import {
  hasPlatformCapability,
  parsePlatformStaffSubjectId,
  platformStaffSubjectId,
} from '../../src/lib/platform-staff';

describe('platform staff access model', () => {
  it('normalizes platform roles without treating them as tenant roles', () => {
    expect(normalizeRole('platform_support')).toBe('platform_support');
    expect(normalizeRole('platform_setup')).toBe('platform_setup');
    expect(normalizeRole('platform_admin')).toBe('platform_admin');
  });

  it('grants support staff impersonation but not platform staff management', () => {
    const permissions = getPermissionsForRole('platform_support');

    expect(permissions).toContain('platform:hospitals:read');
    expect(permissions).toContain('platform:support:impersonate');
    expect(permissions).not.toContain('platform:staff:manage');
    expect(permissions).not.toContain('*');
  });

  it('allows only privileged platform roles to manage staff accounts', () => {
    expect(hasPlatformCapability('super_admin', 'platform:staff:manage')).toBe(true);
    expect(hasPlatformCapability('platform_admin', 'platform:staff:manage')).toBe(true);
    expect(hasPlatformCapability('platform_support', 'platform:staff:manage')).toBe(false);
  });

  it('uses prefixed staff subjects so platform staff never collide with tenant users', () => {
    expect(platformStaffSubjectId(42)).toBe('staff:42');
    expect(parsePlatformStaffSubjectId('staff:42')).toBe(42);
    expect(parsePlatformStaffSubjectId('42')).toBeNull();
    expect(parsePlatformStaffSubjectId('staff:abc')).toBeNull();
  });
});
