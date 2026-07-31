import { describe, expect, it } from 'vitest';
import inventoryRoute from '../src/routes/tenant/inventory';
import permissionRoutes from '../src/routes/tenant/permissions';
import { getPermissionsForRole } from '../packages/shared/src/authz';
import { WORKSPACE_ACCESS, getAvailableWorkspaces, type WorkspaceId } from '../packages/shared/src/workspaceAccess';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

type ManualQaUser = {
  label: string;
  role: string;
  permissions: string[];
  expectedWorkspaces: WorkspaceId[];
  canOpenAccessControl: boolean;
  canDirectAdjustInventory: boolean;
  canApproveInventoryAdjustment: boolean;
};

const manualQaUsers: ManualQaUser[] = [
  {
    label: 'Receptionist',
    role: 'reception',
    permissions: getPermissionsForRole('reception'),
    expectedWorkspaces: ['reception-dashboard', 'lab-dashboard'],
    canOpenAccessControl: false,
    canDirectAdjustInventory: false,
    canApproveInventoryAdjustment: false,
  },
  {
    label: 'Manager',
    role: 'manager',
    permissions: getPermissionsForRole('manager'),
    expectedWorkspaces: ['reception-dashboard', 'manager-dashboard', 'lab-dashboard'],
    canOpenAccessControl: false,
    canDirectAdjustInventory: false,
    canApproveInventoryAdjustment: false,
  },
  {
    label: 'Inventory Operator',
    role: 'manager',
    permissions: ['inventory:read', 'inventory:write'],
    expectedWorkspaces: ['inventory-dashboard', 'inventory-entry'],
    canOpenAccessControl: false,
    canDirectAdjustInventory: false,
    canApproveInventoryAdjustment: false,
  },
  {
    label: 'Inventory Supervisor',
    role: 'manager',
    permissions: ['inventory:read', 'inventory:reports', 'inventory:audit', 'inventory:adjust', 'inventory:approve'],
    expectedWorkspaces: ['inventory-dashboard', 'inventory-reports', 'inventory-supervisor'],
    canOpenAccessControl: false,
    canDirectAdjustInventory: true,
    canApproveInventoryAdjustment: true,
  },
  {
    label: 'Lab Staff',
    role: 'laboratory',
    permissions: getPermissionsForRole('laboratory'),
    expectedWorkspaces: ['inventory-dashboard', 'reagent-control', 'lab-dashboard'],
    canOpenAccessControl: false,
    canDirectAdjustInventory: false,
    canApproveInventoryAdjustment: false,
  },
  {
    label: 'Pharmacist',
    role: 'pharmacist',
    permissions: getPermissionsForRole('pharmacist'),
    expectedWorkspaces: ['inventory-dashboard', 'inventory-entry', 'reagent-control', 'pharmacy-dashboard'],
    canOpenAccessControl: false,
    canDirectAdjustInventory: false,
    canApproveInventoryAdjustment: false,
  },
  {
    label: 'Accountant',
    role: 'accountant',
    permissions: getPermissionsForRole('accountant'),
    expectedWorkspaces: ['inventory-dashboard', 'inventory-reports', 'inventory-supervisor', 'accounting-dashboard', 'reports-dashboard'],
    canOpenAccessControl: false,
    canDirectAdjustInventory: false,
    canApproveInventoryAdjustment: false,
  },
  {
    label: 'Administration',
    role: 'director',
    permissions: getPermissionsForRole('director'),
    expectedWorkspaces: [
      'reception-dashboard',
      'manager-dashboard',
      'inventory-dashboard',
      'inventory-entry',
      'inventory-reports',
      'inventory-supervisor',
      'reagent-control',
      'pharmacy-dashboard',
      'lab-dashboard',
      'accounting-dashboard',
      'reports-dashboard',
      'md-dashboard',
      'director-dashboard',
    ],
    canOpenAccessControl: false,
    canDirectAdjustInventory: true,
    canApproveInventoryAdjustment: true,
  },
  {
    label: 'Admin',
    role: 'hospital_admin',
    permissions: ['*'],
    expectedWorkspaces: WORKSPACE_ACCESS.map((workspace) => workspace.id),
    canOpenAccessControl: true,
    canDirectAdjustInventory: true,
    canApproveInventoryAdjustment: true,
  },
];

const directAdjustmentBody = {
  StoreId: 1,
  Remarks: 'Manual QA regression adjustment',
  Items: [
    {
      ItemId: 1,
      StoreId: 1,
      StockId: 10,
      Quantity: 1,
      AdjustmentType: 'add',
      BatchNo: 'QA-ADJ-001',
      Remarks: 'Inventory adjustment safety check',
    },
  ],
};

function workspaceIdsFor(user: ManualQaUser): WorkspaceId[] {
  return getAvailableWorkspaces(user.permissions, user.role).map((workspace) => workspace.id);
}

function makeDbPermissionOverride(user: ManualQaUser) {
  return (sql: string) => {
    if (sql.includes('FROM role_permission_overrides')) {
      return { first: { permissions: JSON.stringify(user.permissions) } };
    }
    if (sql.includes('FROM user_permission_overrides')) {
      return { results: [] };
    }
    return null;
  };
}

describe('Manual QA — access control test users', () => {
  it.each(manualQaUsers)('$label header switch shows only authorized workspaces and hides unauthorized workspaces', (user) => {
    const actualWorkspaceIds = workspaceIdsFor(user);

    expect(actualWorkspaceIds).toEqual(user.expectedWorkspaces);

    const hiddenWorkspaceIds = WORKSPACE_ACCESS
      .map((workspace) => workspace.id)
      .filter((workspaceId) => !user.expectedWorkspaces.includes(workspaceId));

    for (const hiddenWorkspaceId of hiddenWorkspaceIds) {
      expect(actualWorkspaceIds, `${user.label} must not see ${hiddenWorkspaceId}`).not.toContain(hiddenWorkspaceId);
    }
  });

  it.each(manualQaUsers)('$label direct URL decision blocks Access Control unless roles:manage is effective', (user) => {
    const canAccessPermissionsRoute = user.permissions.includes('*') || user.permissions.includes('roles:manage');

    expect(canAccessPermissionsRoute).toBe(user.canOpenAccessControl);
    expect(workspaceIdsFor(user).includes('access-control')).toBe(user.canOpenAccessControl);
  });

  it.each(manualQaUsers.filter((user) => !user.canOpenAccessControl))('$label API blocks Access Control endpoint without roles:manage', async (user) => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: user.role,
      tenantId: 'tenant-1',
      userId: 900,
      queryOverride: makeDbPermissionOverride(user),
    });

    const res = await app.request('/permissions/catalog');
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(403);
    expect(body.error).toContain('roles:manage');
  });

  it('Admin API can open Access Control endpoint', async () => {
    const admin = manualQaUsers.find((user) => user.label === 'Admin')!;
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: admin.role,
      tenantId: 'tenant-1',
      userId: 901,
      queryOverride: makeDbPermissionOverride(admin),
    });

    const res = await app.request('/permissions/catalog');

    expect(res.status).not.toBe(403);
  });

  it.each(manualQaUsers)('$label inventory adjustment API is permission-safe before handler work', async (user) => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: user.role,
      tenantId: 'tenant-1',
      userId: 902,
      queryOverride: makeDbPermissionOverride(user),
    });

    const res = await jsonRequest(app, '/inventory/stock/adjustment', {
      method: 'POST',
      body: directAdjustmentBody,
    });

    if (user.canDirectAdjustInventory) {
      expect(res.status, `${user.label} has inventory:adjust and should pass permission guard`).not.toBe(403);
      return;
    }

    expect(res.status).toBe(403);
    expect(mockDB.queries.some((query) => query.sql.includes('UPDATE InventoryStock'))).toBe(false);
  });

  it.each(manualQaUsers)('$label adjustment approval API is permission-safe before handler work', async (user) => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: user.role,
      tenantId: 'tenant-1',
      userId: 903,
      queryOverride: makeDbPermissionOverride(user),
    });

    const res = await jsonRequest(app, '/inventory/adjustment-requests/1/approve', {
      method: 'POST',
      body: { Remarks: 'Manual QA approval guard' },
    });

    if (user.canApproveInventoryAdjustment) {
      expect(res.status, `${user.label} has inventory:approve and should pass permission guard`).not.toBe(403);
      return;
    }

    expect(res.status).toBe(403);
    expect(mockDB.queries.some((query) => query.sql.includes('FROM InventoryAdjustmentRequest WHERE'))).toBe(false);
  });
});
