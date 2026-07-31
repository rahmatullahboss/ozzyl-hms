export interface WorkspaceAccessPage {
  label: string;
  path: string;
  requiredPermission: string;
}

export interface WorkspaceAccessGroup {
  label: string;
  pages: WorkspaceAccessPage[];
}

const PAGE_GROUPS: WorkspaceAccessGroup[] = [
  {
    label: 'Core Dashboard',
    pages: [
      { label: 'Dashboard', path: 'dashboard', requiredPermission: 'dashboard:read' },
    ],
  },
  {
    label: 'Reception Workspace',
    pages: [
      { label: 'Reception Dashboard', path: 'reception/dashboard', requiredPermission: 'dashboard:read' },
      { label: 'Reception Patients', path: 'reception/patients', requiredPermission: 'patients:read' },
      { label: 'OPD Serial / Appointments', path: 'reception/appointments', requiredPermission: 'appointments:read' },
      { label: 'Billing Counter', path: 'reception/billing-counter', requiredPermission: 'billing:read' },
      { label: 'Cash Operations', path: 'reception/cash-operations', requiredPermission: 'billing:read' },
      { label: 'Report Delivery', path: 'reception/reports', requiredPermission: 'billing:read' },
    ],
  },
  {
    label: 'Management Workspace',
    pages: [
      { label: 'Staff', path: 'md/staff', requiredPermission: 'staff:read' },
      { label: 'Accounting', path: 'md/accounting', requiredPermission: 'accounting:read' },
      { label: 'Income', path: 'md/income', requiredPermission: 'income:read' },
      { label: 'Expenses', path: 'md/expenses', requiredPermission: 'expenses:read' },
      { label: 'Reports', path: 'md/reports', requiredPermission: 'reports:read' },
    ],
  },
  {
    label: 'Admin Controls',
    pages: [
      { label: 'System Preferences', path: 'settings', requiredPermission: 'settings:read' },
      { label: 'Role Management', path: 'permissions', requiredPermission: 'roles:manage' },
    ],
  },
];

function hasPermission(permissions: readonly string[], requiredPermission: string): boolean {
  return permissions.includes('*') || permissions.includes(requiredPermission);
}

export function getWorkspaceAccessPreview(permissions: readonly string[]): WorkspaceAccessGroup[] {
  return PAGE_GROUPS.map((group) => ({
    label: group.label,
    pages: group.pages.filter((page) => hasPermission(permissions, page.requiredPermission)),
  })).filter((group) => group.pages.length > 0);
}
