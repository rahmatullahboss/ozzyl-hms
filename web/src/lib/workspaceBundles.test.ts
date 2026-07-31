import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_BUNDLES,
  WORKSPACE_LEVEL_GROUPS,
  getMissingWorkspaceBundlePermissions,
  getWorkspaceLevelForPermissions,
  getWorkspaceLevelManagedPermissions,
  isWorkspaceBundleGranted,
} from './workspaceBundles';

describe('workspaceBundles', () => {
  it('defines core workspace bundles without unsafe admin permissions', () => {
    const requiredBundles = [
      'reception-desk',
      'reception-counter-operator',
      'management-cash-receiver',
      'cash-operations',
      'management',
      'accountant-workspace',
      'doctor-management',
      'hr-staff-management',
      'laboratory-workspace',
      'pharmacy-workspace',
      'inventory-operator',
      'reports',
    ];

    for (const id of requiredBundles) {
      expect(WORKSPACE_BUNDLES.find((bundle) => bundle.id === id), `${id} bundle`).toBeDefined();
    }

    const combined = WORKSPACE_BUNDLES.flatMap((bundle) => bundle.permissions);
    expect(combined).not.toContain('roles:manage');
    expect(combined).not.toContain('settings:write');
    expect(combined).not.toContain('users:delete');
  });

  it('keeps reception/cash operations separate from accountant workspace access', () => {
    const cashOperations = WORKSPACE_BUNDLES.find((bundle) => bundle.id === 'cash-operations');
    expect(cashOperations).toBeDefined();
    if (!cashOperations) return;

    expect(cashOperations.permissions).toEqual(expect.arrayContaining(['income:read', 'expenses:read']));
    expect(cashOperations.permissions).not.toContain('accounting:read');
    expect(cashOperations.permissions).not.toContain('billing.counter.management_cash.read');
  });

  it('defines accountant workspace as an explicit accounting bundle', () => {
    const accountant = WORKSPACE_BUNDLES.find((bundle) => bundle.id === 'accountant-workspace');
    expect(accountant).toBeDefined();
    if (!accountant) return;

    expect(accountant.permissions).toEqual(expect.arrayContaining([
      'accounting:read',
      'accounting:write',
      'income:read',
      'expenses:read',
      'billing.counter.management_cash.read',
      'reports:read',
    ]));
  });

  it('calculates missing bundle permissions from effective permissions', () => {
    const management = WORKSPACE_BUNDLES.find((bundle) => bundle.id === 'management');
    expect(management).toBeDefined();
    if (!management) return;

    const partial = ['staff:read', 'accounting:read'];
    expect(isWorkspaceBundleGranted(management, partial)).toBe(false);
    expect(getMissingWorkspaceBundlePermissions(management, partial)).toEqual(
      management.permissions.filter((permission) => !partial.includes(permission)),
    );
    expect(isWorkspaceBundleGranted(management, management.permissions)).toBe(true);
  });

  it('defines inventory workspace levels without auto-granting approval, audit or stock adjustment', () => {
    const inventory = WORKSPACE_LEVEL_GROUPS.find((group) => group.id === 'inventory');
    expect(inventory).toBeDefined();
    if (!inventory) return;

    const view = inventory.options.find((option) => option.level === 'view');
    const operate = inventory.options.find((option) => option.level === 'operate');
    const approve = inventory.options.find((option) => option.level === 'approve');
    const admin = inventory.options.find((option) => option.level === 'admin');

    expect(view?.permissions).toEqual(['inventory:read', 'inventory:reports']);
    expect(operate?.permissions).toEqual(['inventory:read', 'inventory:write', 'inventory:transfer', 'inventory:reports']);
    expect(approve?.permissions).toEqual(['inventory:read', 'inventory:write', 'inventory:transfer', 'inventory:reports', 'inventory:assets']);
    expect(admin?.permissions).toEqual(expect.arrayContaining(['inventory:assets', 'inventory:consume']));
    expect(getWorkspaceLevelManagedPermissions(inventory)).not.toContain('inventory:adjust');
    expect(getWorkspaceLevelManagedPermissions(inventory)).not.toContain('inventory:approve');
    expect(getWorkspaceLevelManagedPermissions(inventory)).not.toContain('inventory:audit');
    expect(inventory.criticalPermissions).toEqual(expect.arrayContaining(['inventory:adjust', 'inventory:approve', 'inventory:audit']));
  });

  it('detects the highest matching inventory level from effective permissions', () => {
    const inventory = WORKSPACE_LEVEL_GROUPS.find((group) => group.id === 'inventory');
    expect(inventory).toBeDefined();
    if (!inventory) return;

    expect(getWorkspaceLevelForPermissions(inventory, [])?.level).toBe('off');
    expect(getWorkspaceLevelForPermissions(inventory, ['inventory:read', 'inventory:reports'])?.level).toBe('view');
    expect(getWorkspaceLevelForPermissions(inventory, ['inventory:read', 'inventory:write', 'inventory:transfer', 'inventory:reports', 'inventory:assets', 'inventory:adjust'])?.level).toBe('approve');
  });
});
