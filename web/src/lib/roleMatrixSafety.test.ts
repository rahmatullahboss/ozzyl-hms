import { describe, expect, it } from 'vitest';

import {
  buildRoleMatrixSaveConfirmation,
  getPermissionDiff,
  isProtectedRoleMatrixRole,
} from './roleMatrixSafety';

describe('roleMatrixSafety', () => {
  it('protects hospital_admin from role matrix edits', () => {
    expect(isProtectedRoleMatrixRole('hospital_admin')).toBe(true);
    expect(isProtectedRoleMatrixRole('manager')).toBe(false);
  });

  it('calculates added and removed permissions for save confirmation', () => {
    const diff = getPermissionDiff(['dashboard:read', 'billing:read'], ['dashboard:read', 'reports:read']);
    expect(diff.added).toEqual(['reports:read']);
    expect(diff.removed).toEqual(['billing:read']);
  });

  it('builds a clear role matrix save warning', () => {
    const message = buildRoleMatrixSaveConfirmation({
      roleLabel: 'Manager',
      added: ['staff:read'],
      removed: ['billing:read'],
    });

    expect(message).toContain('Save permission changes for Manager');
    expect(message).toContain('real role permissions');
    expect(message).toContain('staff:read');
    expect(message).toContain('billing:read');
  });
});
