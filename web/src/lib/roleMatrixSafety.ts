export interface PermissionDiff {
  added: string[];
  removed: string[];
}

interface RoleMatrixSaveConfirmationArgs extends PermissionDiff {
  roleLabel: string;
}

export function isProtectedRoleMatrixRole(role: string): boolean {
  return role === 'hospital_admin' || role === 'super_admin';
}

export function getPermissionDiff(before: readonly string[], after: readonly string[]): PermissionDiff {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: [...afterSet].filter((permission) => !beforeSet.has(permission)).sort(),
    removed: [...beforeSet].filter((permission) => !afterSet.has(permission)).sort(),
  };
}

export function buildRoleMatrixSaveConfirmation({
  roleLabel,
  added,
  removed,
}: RoleMatrixSaveConfirmationArgs): string {
  const sections: string[] = [
    `Save permission changes for ${roleLabel}?`,
    'This changes real role permissions and will affect existing page access/sidebar visibility after refresh or next login.',
  ];

  if (added.length > 0) sections.push(`Added permissions:\n- ${added.join('\n- ')}`);
  if (removed.length > 0) sections.push(`Removed permissions:\n- ${removed.join('\n- ')}`);
  if (added.length === 0 && removed.length === 0) sections.push('No permission changes detected.');

  return sections.join('\n\n');
}
