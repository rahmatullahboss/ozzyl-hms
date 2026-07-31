/**
 * Role-based sidebar visibility configuration for admin sub-roles.
 * Maps each admin sub-role to which sidebar groupKeys they can see.
 *
 * If a role is not in this map, they see everything (hospital_admin default).
 */

type AdminSubRole = 'hospital_admin' | 'branch_manager' | 'accounts_manager' | 'auditor' | 'owner_view';

const SUPER_ADMIN_GROUPS = ['groupPlatform', 'groupHospitals', 'groupSystem'];

const ALL_GROUPS = [
  'groupStarterControl',
  'groupReagentStock',
  'groupPatientServices',
  'groupActionCenter',
  'groupReportsAnalytics',
  'groupAdvancedOperations',
  'groupPeopleAccess',
  'groupAdvancedLabLis',
  'groupAuditSecurity',
  'groupSettings',
];

export const ROLE_SIDEBAR_ACCESS: Record<AdminSubRole, string[]> = {
  hospital_admin: ALL_GROUPS,
  branch_manager: [
    'groupStarterControl',
    'groupReagentStock',
    'groupPatientServices',
    'groupActionCenter',
    'groupReportsAnalytics',
    'groupAdvancedOperations',
    'groupPeopleAccess',
  ],
  accounts_manager: [
    'groupStarterControl',
    'groupReportsAnalytics',
  ],
  auditor: [
    'groupReportsAnalytics',
    'groupAuditSecurity',
  ],
  owner_view: [
    'groupStarterControl',
    'groupReagentStock',
    'groupReportsAnalytics',
  ],
};

export function getVisibleGroups(role: string): string[] {
  const normalized = role.toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'super_admin') return SUPER_ADMIN_GROUPS;
  return ROLE_SIDEBAR_ACCESS[normalized as AdminSubRole] ?? ALL_GROUPS;
}

export function isGroupVisible(role: string, groupKey?: string): boolean {
  if (!groupKey) return true; // Dashboard group (no key) always visible
  return getVisibleGroups(role).includes(groupKey);
}
