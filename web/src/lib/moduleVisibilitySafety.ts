import { getPermissionsForModule } from '@shared/authz';

interface ModuleVisibilityConfirmationArgs {
  role: string;
  moduleLabel: string;
  nextVisible: boolean;
  affectedPermissions?: readonly string[];
}

export function isProtectedModuleVisibilityRole(role: string): boolean {
  return role === 'hospital_admin' || role === 'super_admin';
}

export function getModuleVisibilityAffectedPermissions(module: string): string[] {
  return getPermissionsForModule(module);
}

export function buildModuleVisibilityConfirmation({
  role,
  moduleLabel,
  nextVisible,
  affectedPermissions = [],
}: ModuleVisibilityConfirmationArgs): string {
  const actionLabel = nextVisible ? 'Show' : 'Hide';
  const permissionsText = affectedPermissions.length > 0
    ? `\n\nAffected permissions:\n- ${affectedPermissions.join('\n- ')}`
    : '';

  return `${actionLabel} ${moduleLabel} for ${role.replace(/_/g, ' ')}?\n\nThis changes real role permissions and will affect existing page access/sidebar visibility after refresh or next login.${permissionsText}`;
}
