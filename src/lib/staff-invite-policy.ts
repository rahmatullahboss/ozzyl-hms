export const TENANT_INVITE_ROLES = [
  'doctor',
  'nurse',
  'laboratory',
  'reception',
  'manager',
  'md',
  'director',
  'pharmacist',
  'accountant',
  'shareholder_viewer',
] as const;

export const PRIVILEGED_STAFF_INVITE_ROLES = new Set([
  'manager',
  'md',
  'director',
  'accountant',
  'shareholder_viewer',
]);

export const FORBIDDEN_TENANT_INVITE_ROLES = new Set([
  'hospital_admin',
  'super_admin',
]);

export function isAllowedTenantInviteRole(role: string): boolean {
  return TENANT_INVITE_ROLES.includes(role as (typeof TENANT_INVITE_ROLES)[number]);
}

export function isPrivilegedStaffInviteRole(role: string): boolean {
  return PRIVILEGED_STAFF_INVITE_ROLES.has(role);
}

export function isForbiddenTenantInviteRole(role: string): boolean {
  return FORBIDDEN_TENANT_INVITE_ROLES.has(role);
}
