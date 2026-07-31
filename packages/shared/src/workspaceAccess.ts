export type WorkspaceAccessLevel =
  | 'front_desk'
  | 'department'
  | 'supervisor'
  | 'management'
  | 'executive'
  | 'admin';

export type WorkspaceId =
  | 'reception-dashboard'
  | 'manager-dashboard'
  | 'inventory-dashboard'
  | 'inventory-entry'
  | 'inventory-reports'
  | 'inventory-supervisor'
  | 'reagent-control'
  | 'pharmacy-dashboard'
  | 'lab-dashboard'
  | 'doctor-dashboard'
  | 'nursing-dashboard'
  | 'accounting-dashboard'
  | 'reports-dashboard'
  | 'md-dashboard'
  | 'director-dashboard'
  | 'access-control';

export interface WorkspaceAccessDefinition {
  id: WorkspaceId;
  label: string;
  description: string;
  path: string;
  level: WorkspaceAccessLevel;
  requiredPermissions: readonly string[];
}

export const WORKSPACE_ACCESS: readonly WorkspaceAccessDefinition[] = [
  {
    id: 'reception-dashboard',
    label: 'Reception Dashboard',
    description: 'Front-desk workspace for patient lookup, appointments, billing counter and report delivery.',
    path: 'reception/dashboard',
    level: 'front_desk',
    requiredPermissions: ['billing.counter.read', 'billing.counter.invoice.create'],
  },
  {
    id: 'manager-dashboard',
    label: 'Manager Dashboard',
    description: 'Operations command center for manager-level monitoring, alerts, tasks and department status.',
    path: 'manager/dashboard',
    level: 'management',
    requiredPermissions: ['manager.dashboard.read'],
  },
  {
    id: 'inventory-dashboard',
    label: 'Inventory Dashboard',
    description: 'Inventory overview workspace for stock position, movements, alerts and day-to-day supply visibility.',
    path: 'inventory/overview',
    level: 'department',
    requiredPermissions: ['inventory:read'],
  },
  {
    id: 'inventory-entry',
    label: 'Inventory Entry',
    description: 'Operational entry workspace for stock receive, issue, transfer and inventory write actions.',
    path: 'inventory/gr/new',
    level: 'department',
    requiredPermissions: ['inventory:write'],
  },
  {
    id: 'inventory-reports',
    label: 'Inventory Reports',
    description: 'Inventory reporting workspace for stock reports, audit-ready summaries and consumption analysis.',
    path: 'inventory/reports',
    level: 'management',
    requiredPermissions: ['inventory:reports'],
  },
  {
    id: 'inventory-supervisor',
    label: 'Inventory Supervisor',
    description: 'Supervisor workspace for stock approval, audit review and controlled inventory corrections. Direct stock adjustment stays as a separate critical permission.',
    path: 'inventory/adjustment-requests',
    level: 'supervisor',
    requiredPermissions: ['inventory:approve', 'inventory:audit'],
  },
  {
    id: 'reagent-control',
    label: 'Reagent Control',
    description: 'Lab reagent and auto-consumption control workspace for test-linked deduction rules and exception review.',
    path: 'reagent-control',
    level: 'supervisor',
    requiredPermissions: ['inventory:consume'],
  },
  {
    id: 'pharmacy-dashboard',
    label: 'Pharmacy Dashboard',
    description: 'Pharmacy workspace for medicine stock, dispensing, purchase flow and prescription fulfillment.',
    path: 'pharmacy/dashboard',
    level: 'department',
    requiredPermissions: ['pharmacy:read', 'pharmacy:write'],
  },
  {
    id: 'lab-dashboard',
    label: 'Lab Dashboard',
    description: 'Laboratory workspace for test processing, lab orders, machines, QC and report workflow.',
    path: 'lab/dashboard',
    level: 'department',
    requiredPermissions: ['tests:read'],
  },
  {
    id: 'doctor-dashboard',
    label: 'Doctor Dashboard',
    description: 'Doctor workspace for patient review, prescriptions, lab results and OPD/IPD clinical work.',
    path: 'doctor/dashboard',
    level: 'department',
    requiredPermissions: ['prescriptions:write'],
  },
  {
    id: 'nursing-dashboard',
    label: 'Nursing Dashboard',
    description: 'Nursing station workspace for admitted patient care, vitals, medication tasks and ward operations.',
    path: 'nurse-station',
    level: 'department',
    requiredPermissions: ['nursing:read'],
  },
  {
    id: 'accounting-dashboard',
    label: 'Accounting Dashboard',
    description: 'Accounting workspace for cash book, billing visibility, income, expenses and financial records.',
    path: 'accountant/dashboard',
    level: 'management',
    requiredPermissions: ['accounting:read', 'accounting:write'],
  },
  {
    id: 'reports-dashboard',
    label: 'Reports Dashboard',
    description: 'Reports and analytics workspace for operational, clinical and financial reporting visibility.',
    path: 'reports',
    level: 'management',
    requiredPermissions: ['reports:read'],
  },
  {
    id: 'md-dashboard',
    label: 'MD Dashboard',
    description: 'Managing director workspace for staff, accounting, cash, reports, audit and business monitoring.',
    path: 'md/dashboard',
    level: 'executive',
    requiredPermissions: ['profit:calculate'],
  },
  {
    id: 'director-dashboard',
    label: 'Administration Dashboard',
    description: 'Administration workspace for executive oversight, financial control, profit approval and shareholder visibility.',
    path: 'director/dashboard',
    level: 'executive',
    requiredPermissions: ['profit:approve', 'shareholders:write'],
  },
  {
    id: 'access-control',
    label: 'Access Control',
    description: 'Administration workspace for user management, role permissions, audit review and protected system access.',
    path: 'permissions',
    level: 'admin',
    requiredPermissions: ['roles:manage'],
  },
] as const;

function buildEffectivePermissionSet(effectivePermissions: readonly string[] = []): Set<string> {
  return new Set(effectivePermissions);
}

export function hasWorkspaceAccess(
  workspace: WorkspaceAccessDefinition,
  effectivePermissions: readonly string[] = [],
  role?: string | null,
): boolean {
  void role;

  const permissionSet = buildEffectivePermissionSet(effectivePermissions);
  if (permissionSet.has('*')) return true;

  return workspace.requiredPermissions.some((permission) => permissionSet.has(permission));
}

export function getWorkspaceAccessDefinition(workspaceId: WorkspaceId): WorkspaceAccessDefinition | undefined {
  return WORKSPACE_ACCESS.find((workspace) => workspace.id === workspaceId);
}

export function getAvailableWorkspaces(
  effectivePermissions: readonly string[] = [],
  role?: string | null,
): WorkspaceAccessDefinition[] {
  const availableWorkspaces: WorkspaceAccessDefinition[] = [];
  const addedWorkspaceIds = new Set<WorkspaceId>();

  for (const workspace of WORKSPACE_ACCESS) {
    if (addedWorkspaceIds.has(workspace.id)) continue;
    if (!hasWorkspaceAccess(workspace, effectivePermissions, role)) continue;

    availableWorkspaces.push(workspace);
    addedWorkspaceIds.add(workspace.id);
  }

  return availableWorkspaces;
}
