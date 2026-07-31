import { describe, expect, it } from 'vitest';
import {
  CRITICAL_PERMISSIONS,
  getCriticalPermissionReason,
  isCriticalPermission,
  isNormalWorkspaceToggleExcludedPermission,
} from '../../packages/shared/src/criticalPermissions';

describe('critical permission catalog', () => {
  it('marks explicit high-risk permissions as critical', () => {
    for (const permission of [
      'roles:manage',
      'settings:write',
      'users:delete',
      'staff:delete',
      'billing:refund',
      'billing:cancel',
      'billing.counter.force_close',
      'billing.counter.takeover',
      'billing.counter.discount.approve',
      'billing.counter.variance.approve',
      'billing.counter.bank_deposit.approve',
      'inventory:adjust',
      'inventory:approve',
      'inventory:audit',
      'accounting:write',
      'reports:export',
      'pharmacy:narcotics',
      'shareholders:delete',
    ]) {
      expect(isCriticalPermission(permission), permission).toBe(true);
      expect(getCriticalPermissionReason(permission), permission).toEqual(expect.any(String));
    }
  });

  it('does not mark ordinary read permissions as critical', () => {
    for (const permission of ['dashboard:read', 'patients:read', 'reports:read', 'tests:read']) {
      expect(isCriticalPermission(permission), permission).toBe(false);
      expect(getCriticalPermissionReason(permission), permission).toBeNull();
    }
  });

  it('stores business labels and severity metadata for every critical permission', () => {
    for (const entry of CRITICAL_PERMISSIONS) {
      expect(entry.permission).toEqual(expect.any(String));
      expect(entry.label).toEqual(expect.any(String));
      expect(entry.reason).toEqual(expect.any(String));
      expect(['high', 'critical']).toContain(entry.severity);
    }
  });

  it('keeps the critical workspace-toggle exclusion list explicit', async () => {
    const { NORMAL_WORKSPACE_TOGGLE_EXCLUDED_PERMISSIONS } = await import('../../packages/shared/src/criticalPermissions');

    expect(NORMAL_WORKSPACE_TOGGLE_EXCLUDED_PERMISSIONS).toEqual([
      'roles:manage',
      'settings:write',
      'users:delete',
      'inventory:adjust',
      'inventory:approve',
      'inventory:audit',
      'billing.counter.force_close',
      'billing.counter.discount.approve',
      'billing.counter.variance.approve',
      'billing:refund',
      'billing:cancel',
    ]);

    for (const permission of NORMAL_WORKSPACE_TOGGLE_EXCLUDED_PERMISSIONS) {
      expect(isNormalWorkspaceToggleExcludedPermission(permission), permission).toBe(true);
    }
    expect(isNormalWorkspaceToggleExcludedPermission('inventory:read')).toBe(false);
  });
});
