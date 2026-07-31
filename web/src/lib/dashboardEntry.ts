import {
  getAvailableWorkspaces,
  type WorkspaceAccessDefinition,
  type WorkspaceId,
} from '@shared/workspaceAccess';

const ROLE_WORKSPACE_PREFERENCES: Record<string, readonly WorkspaceId[]> = {
  doctor: ['doctor-dashboard', 'reports-dashboard'],
  nurse: ['nursing-dashboard', 'reception-dashboard'],
  laboratory: ['lab-dashboard', 'inventory-dashboard'],
  reception: ['reception-dashboard', 'lab-dashboard'],
  receptionist: ['reception-dashboard', 'lab-dashboard'],
  pharmacist: ['pharmacy-dashboard', 'inventory-dashboard'],
  manager: ['manager-dashboard', 'reception-dashboard', 'lab-dashboard', 'reports-dashboard'],
  md: ['md-dashboard', 'manager-dashboard', 'reports-dashboard', 'accounting-dashboard', 'reception-dashboard'],
  director: ['director-dashboard', 'md-dashboard', 'manager-dashboard', 'reports-dashboard', 'accounting-dashboard'],
  accountant: ['accounting-dashboard', 'reports-dashboard', 'reception-dashboard'],
};

export function resolveDashboardEntryWorkspace(
  role: string | null | undefined,
  effectivePermissions: readonly string[] = [],
): WorkspaceAccessDefinition | null {
  if (!role || role === 'hospital_admin' || role === 'super_admin') return null;

  const available = getAvailableWorkspaces(effectivePermissions, role);
  if (available.length === 0) return null;

  const availableById = new Map(available.map((workspace) => [workspace.id, workspace]));
  for (const workspaceId of ROLE_WORKSPACE_PREFERENCES[role] ?? []) {
    const workspace = availableById.get(workspaceId);
    if (workspace) return workspace;
  }

  return available[0] ?? null;
}
