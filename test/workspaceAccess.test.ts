import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_ACCESS,
  getAvailableWorkspaces,
  getWorkspaceAccessDefinition,
  hasWorkspaceAccess,
  type WorkspaceId,
} from '../packages/shared/src/workspaceAccess';
import { getAvailableWorkspaces as getAvailableWorkspacesFromSharedIndex } from '../packages/shared/src/index';
import { getPermissionsForRole, isRoleAllowed, normalizeRole } from '../packages/shared/src/authz';

const REQUIRED_WORKSPACE_IDS: WorkspaceId[] = [
  'reception-dashboard',
  'manager-dashboard',
  'inventory-dashboard',
  'inventory-entry',
  'inventory-reports',
  'inventory-supervisor',
  'reagent-control',
  'pharmacy-dashboard',
  'lab-dashboard',
  'doctor-dashboard',
  'nursing-dashboard',
  'accounting-dashboard',
  'reports-dashboard',
  'md-dashboard',
  'director-dashboard',
  'access-control',
];

function workspaceIdsFor(effectivePermissions: string[], role?: string): WorkspaceId[] {
  return getAvailableWorkspaces(effectivePermissions, role).map((workspace) => workspace.id);
}

describe('workspaceAccess', () => {
  it('normalizes pharmacy role alias to pharmacist permissions', () => {
    expect(normalizeRole('pharmacy')).toBe('pharmacist');
    expect(isRoleAllowed('pharmacy', ['pharmacist'])).toBe(true);
    expect(getPermissionsForRole('pharmacy')).toEqual(getPermissionsForRole('pharmacist'));
  });

  it('defines the required phase-1 workspace catalog with stable ids', () => {
    const workspaceIds = WORKSPACE_ACCESS.map((workspace) => workspace.id);

    expect(workspaceIds).toEqual(REQUIRED_WORKSPACE_IDS);
    expect(new Set(workspaceIds).size).toBe(REQUIRED_WORKSPACE_IDS.length);
    expect(WORKSPACE_ACCESS).toHaveLength(REQUIRED_WORKSPACE_IDS.length);
  });

  it('keeps every workspace definition complete for future UI routing', () => {
    for (const workspace of WORKSPACE_ACCESS) {
      expect(workspace.label.trim()).not.toBe('');
      expect(workspace.description.trim()).not.toBe('');
      expect(workspace.path.trim()).not.toBe('');
      expect(workspace.level).toMatch(/^(front_desk|department|supervisor|management|executive|admin)$/);
      expect(workspace.requiredPermissions.length).toBeGreaterThan(0);
    }
  });

  it('returns a workspace definition by id', () => {
    expect(getWorkspaceAccessDefinition('inventory-supervisor')).toMatchObject({
      id: 'inventory-supervisor',
      label: 'Inventory Supervisor',
      path: 'inventory/adjustment-requests',
      level: 'supervisor',
      requiredPermissions: ['inventory:approve', 'inventory:audit'],
    });
  });

  it('grants all workspaces only when wildcard permission is present', () => {
    expect(workspaceIdsFor(['*'])).toEqual(REQUIRED_WORKSPACE_IDS);
    expect(workspaceIdsFor(['*'], 'reception')).toEqual(REQUIRED_WORKSPACE_IDS);
    expect(workspaceIdsFor([], 'hospital_admin')).toEqual([]);
    expect(workspaceIdsFor([], 'super_admin')).toEqual([]);
  });

  it('uses permissions as the final decision and treats role only as context', () => {
    expect(workspaceIdsFor(['inventory:read'], 'manager')).toEqual(['inventory-dashboard']);
    expect(workspaceIdsFor(['inventory:write'], 'manager')).toEqual(['inventory-entry']);
    expect(workspaceIdsFor(['roles:manage'], 'manager')).toEqual(['access-control']);
    expect(workspaceIdsFor([], 'manager')).toEqual([]);
  });

  it('matches the phase-2 permission examples exactly', () => {
    expect(workspaceIdsFor(['inventory:read'], 'manager')).toEqual(['inventory-dashboard']);
    expect(workspaceIdsFor(['inventory:write'], 'manager')).toEqual(['inventory-entry']);
    expect(workspaceIdsFor(['roles:manage'])).toEqual(['access-control']);

    const workspaceIdsWithoutInventoryPermissions = workspaceIdsFor(['manager.dashboard.read'], 'manager');
    expect(workspaceIdsWithoutInventoryPermissions).toEqual(['manager-dashboard']);
    expect(workspaceIdsWithoutInventoryPermissions).not.toContain('inventory-dashboard');
    expect(workspaceIdsWithoutInventoryPermissions).not.toContain('inventory-entry');
    expect(workspaceIdsWithoutInventoryPermissions).not.toContain('inventory-reports');
    expect(workspaceIdsWithoutInventoryPermissions).not.toContain('inventory-supervisor');
    expect(workspaceIdsWithoutInventoryPermissions).not.toContain('reagent-control');
  });

  it('shows a workspace when any configured workspace permission is present', () => {
    const accessControl = getWorkspaceAccessDefinition('access-control');
    const inventorySupervisor = getWorkspaceAccessDefinition('inventory-supervisor');
    expect(accessControl).toBeDefined();
    expect(inventorySupervisor).toBeDefined();

    expect(hasWorkspaceAccess(accessControl!, ['roles:manage'])).toBe(true);
    expect(hasWorkspaceAccess(accessControl!, ['users:read', 'users:write', 'audit:read'])).toBe(false);
    expect(hasWorkspaceAccess(inventorySupervisor!, ['inventory:adjust'])).toBe(false);
    expect(hasWorkspaceAccess(inventorySupervisor!, ['inventory:approve'])).toBe(true);
  });

  it('hides inventory workspaces when inventory permissions are missing', () => {
    const workspaceIds = workspaceIdsFor(['manager.dashboard.read'], 'manager');

    expect(workspaceIds).toEqual(['manager-dashboard']);
    expect(workspaceIds).not.toContain('inventory-dashboard');
    expect(workspaceIds).not.toContain('inventory-entry');
    expect(workspaceIds).not.toContain('inventory-reports');
    expect(workspaceIds).not.toContain('inventory-supervisor');
    expect(workspaceIds).not.toContain('reagent-control');
  });

  it('hides inventory workspaces for non-inventory role context without inventory permissions', () => {
    expect(workspaceIdsFor([], 'manager')).toEqual([]);
    expect(workspaceIdsFor(['roles:manage'], 'manager')).toEqual(['access-control']);

    const managerPharmacyWorkspaceIds = workspaceIdsFor(['pharmacy:read'], 'manager');
    expect(managerPharmacyWorkspaceIds).toEqual(['pharmacy-dashboard']);
    expect(managerPharmacyWorkspaceIds).not.toContain('inventory-dashboard');
    expect(managerPharmacyWorkspaceIds).not.toContain('inventory-entry');
    expect(managerPharmacyWorkspaceIds).not.toContain('inventory-reports');
    expect(managerPharmacyWorkspaceIds).not.toContain('inventory-supervisor');
    expect(managerPharmacyWorkspaceIds).not.toContain('reagent-control');

    const mdReportsWorkspaceIds = workspaceIdsFor(['reports:read'], 'md');
    expect(mdReportsWorkspaceIds).toEqual(['reports-dashboard']);
    expect(mdReportsWorkspaceIds).not.toContain('md-dashboard');
  });

  it('shows each non-inventory workspace from its own permission without leaking inventory access', () => {
    const restrictedInventoryWorkspaceIds: WorkspaceId[] = [
      'inventory-dashboard',
      'inventory-entry',
      'inventory-reports',
      'inventory-supervisor',
      'reagent-control',
    ];
    const permissionExpectations: Array<[string, WorkspaceId]> = [
      ['pharmacy:read', 'pharmacy-dashboard'],
      ['tests:read', 'lab-dashboard'],
      ['roles:manage', 'access-control'],
      ['profit:approve', 'director-dashboard'],
      ['prescriptions:write', 'doctor-dashboard'],
      ['nursing:read', 'nursing-dashboard'],
      ['accounting:read', 'accounting-dashboard'],
      ['reports:read', 'reports-dashboard'],
      ['billing.counter.read', 'reception-dashboard'],
      ['profit:calculate', 'md-dashboard'],
      ['manager.dashboard.read', 'manager-dashboard'],
      ['billing.counter.invoice.create', 'reception-dashboard'],
    ];

    for (const [permission, expectedWorkspaceId] of permissionExpectations) {
      const workspaceIds = workspaceIdsFor([permission]);

      expect(workspaceIds).toEqual([expectedWorkspaceId]);
      for (const restrictedWorkspaceId of restrictedInventoryWorkspaceIds) {
        expect(workspaceIds).not.toContain(restrictedWorkspaceId);
      }
    }
  });

  it('shows each inventory workspace from its own inventory permission', () => {
    expect(workspaceIdsFor(['inventory:read'])).toEqual(['inventory-dashboard']);
    expect(workspaceIdsFor(['inventory:write'])).toEqual(['inventory-entry']);
    expect(workspaceIdsFor(['inventory:reports'])).toEqual(['inventory-reports']);
    expect(workspaceIdsFor(['inventory:adjust'])).toEqual([]);
    expect(workspaceIdsFor(['inventory:approve'])).toEqual(['inventory-supervisor']);
    expect(workspaceIdsFor(['inventory:audit'])).toEqual(['inventory-supervisor']);
    expect(workspaceIdsFor(['inventory:consume'])).toEqual(['reagent-control']);
    expect(workspaceIdsFor(['lab_machines:read'])).toEqual([]);
    expect(workspaceIdsFor(['tests:write'])).toEqual([]);
    expect(workspaceIdsFor(['inventory:write'])).toEqual(['inventory-entry']);
    expect(workspaceIdsFor(['inventory:transfer'])).toEqual([]);
    expect(workspaceIdsFor(['inventory:read'], 'manager')).toEqual(['inventory-dashboard']);
    expect(workspaceIdsFor(['inventory:write'], 'manager')).toEqual(['inventory-entry']);
    expect(workspaceIdsFor(['inventory:transfer'], 'manager')).toEqual([]);
    expect(workspaceIdsFor(['inventory:read'], 'accountant')).toEqual(['inventory-dashboard']);
    expect(workspaceIdsFor(['inventory:write'], 'accountant')).toEqual(['inventory-entry']);
    expect(workspaceIdsFor(['inventory:transfer'], 'accountant')).toEqual([]);
  });

  it('keeps stable catalog order for mixed permissions regardless of permission input order', () => {
    const stableWorkspaceOrder: WorkspaceId[] = [
      'manager-dashboard',
      'inventory-dashboard',
      'inventory-entry',
      'reports-dashboard',
      'access-control',
    ];

    expect(workspaceIdsFor([
      'roles:manage',
      'inventory:write',
      'manager.dashboard.read',
      'inventory:read',
      'reports:read',
    ])).toEqual(stableWorkspaceOrder);

    expect(workspaceIdsFor([
      'reports:read',
      'inventory:read',
      'roles:manage',
      'manager.dashboard.read',
      'inventory:write',
    ])).toEqual(stableWorkspaceOrder);
  });

  it('does not return duplicate workspaces when multiple permissions match the same workspace', () => {
    expect(workspaceIdsFor(['inventory:approve', 'inventory:adjust', 'inventory:audit'])).toEqual([
      'inventory-supervisor',
    ]);
    expect(workspaceIdsFor(['profit:approve', 'shareholders:write'])).toEqual(['director-dashboard']);
    expect(workspaceIdsFor(['doctor:read'])).toEqual([]);
    expect(workspaceIdsFor(['prescriptions:read'])).toEqual([]);
    expect(workspaceIdsFor(['prescriptions:write'])).toEqual(['doctor-dashboard']);
    expect(workspaceIdsFor(['inventory:read', 'inventory:read', 'inventory:write'])).toEqual([
      'inventory-dashboard',
      'inventory-entry',
    ]);
    expect(workspaceIdsFor(['inventory:consume', 'inventory:consume'])).toEqual(['reagent-control']);
  });

  it('does not return duplicate workspaces for wildcard access', () => {
    const wildcardWorkspaceIds = workspaceIdsFor(['*']);

    expect(wildcardWorkspaceIds).toEqual(REQUIRED_WORKSPACE_IDS);
    expect(wildcardWorkspaceIds).toHaveLength(REQUIRED_WORKSPACE_IDS.length);
    expect(new Set(wildcardWorkspaceIds).size).toBe(wildcardWorkspaceIds.length);
  });

  it('supports importing workspace access helpers through the shared package index', () => {
    function workspaceIdsFromSharedIndex(effectivePermissions: string[], role?: string): WorkspaceId[] {
      return getAvailableWorkspacesFromSharedIndex(effectivePermissions, role).map((workspace) => workspace.id);
    }

    expect(workspaceIdsFromSharedIndex(['*'], 'hospital_admin')).toEqual(REQUIRED_WORKSPACE_IDS);
    expect(workspaceIdsFromSharedIndex(['roles:manage'], 'hospital_admin')).toEqual(['access-control']);
    expect(workspaceIdsFromSharedIndex([], 'hospital_admin')).toEqual([]);
    expect(workspaceIdsFromSharedIndex(['inventory:read'], 'manager')).toEqual(['inventory-dashboard']);
    expect(workspaceIdsFromSharedIndex(['inventory:write'], 'manager')).toEqual(['inventory-entry']);
  });
});
