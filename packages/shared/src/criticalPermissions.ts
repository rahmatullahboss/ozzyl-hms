export type CriticalPermissionSeverity = 'high' | 'critical';

export interface CriticalPermissionDefinition {
  permission: string;
  label: string;
  reason: string;
  severity: CriticalPermissionSeverity;
  category: 'money' | 'data' | 'access' | 'export' | 'inventory' | 'pharmacy';
}

export const NORMAL_WORKSPACE_TOGGLE_EXCLUDED_PERMISSIONS = [
  'roles:manage',
  'settings:write',
  'users:delete',
  'inventory:adjust',
  'inventory:approve',
  'inventory:audit',
  'billing.counter.force_close',
  'billing.counter.discount.approve',
  'billing.counter.variance.approve',
  'billing:refund',
  'billing:cancel',
] as const;

const NORMAL_WORKSPACE_TOGGLE_EXCLUDED_PERMISSION_SET = new Set<string>(NORMAL_WORKSPACE_TOGGLE_EXCLUDED_PERMISSIONS);

export function isNormalWorkspaceToggleExcludedPermission(permission: string): boolean {
  return NORMAL_WORKSPACE_TOGGLE_EXCLUDED_PERMISSION_SET.has(permission);
}

export const CRITICAL_PERMISSIONS: readonly CriticalPermissionDefinition[] = [
  {
    permission: 'roles:manage',
    label: 'Manage roles and permissions',
    reason: 'change access for other staff members',
    severity: 'critical',
    category: 'access',
  },
  {
    permission: 'settings:write',
    label: 'Change system settings',
    reason: 'change hospital-wide system settings',
    severity: 'critical',
    category: 'access',
  },
  {
    permission: 'users:delete',
    label: 'Deactivate users',
    reason: 'deactivate user logins',
    severity: 'critical',
    category: 'access',
  },
  {
    permission: 'staff:delete',
    label: 'Delete staff records',
    reason: 'delete or deactivate staff records',
    severity: 'critical',
    category: 'data',
  },
  {
    permission: 'billing:refund',
    label: 'Issue refunds',
    reason: 'refund payments',
    severity: 'critical',
    category: 'money',
  },
  {
    permission: 'billing:cancel',
    label: 'Cancel bills',
    reason: 'cancel posted bills or financial records',
    severity: 'high',
    category: 'money',
  },
  {
    permission: 'billing.counter.discount.approve',
    label: 'Approve discounts',
    reason: 'approve billing discounts',
    severity: 'high',
    category: 'money',
  },
  {
    permission: 'billing.counter.variance.approve',
    label: 'Approve cash variance',
    reason: 'approve cash drawer variances',
    severity: 'critical',
    category: 'money',
  },
  {
    permission: 'billing.counter.bank_deposit.approve',
    label: 'Approve bank deposit',
    reason: 'approve bank deposit records',
    severity: 'critical',
    category: 'money',
  },
  {
    permission: 'billing.counter.force_close',
    label: 'Force close counter',
    reason: 'force close another counter or cash drawer',
    severity: 'critical',
    category: 'money',
  },
  {
    permission: 'billing.counter.takeover',
    label: 'Take over counter',
    reason: 'take over another active counter session',
    severity: 'critical',
    category: 'money',
  },
  {
    permission: 'inventory:adjust',
    label: 'Adjust stock',
    reason: 'adjust stock balances',
    severity: 'high',
    category: 'inventory',
  },
  {
    permission: 'inventory:approve',
    label: 'Approve inventory changes',
    reason: 'approve inventory movement or stock changes',
    severity: 'high',
    category: 'inventory',
  },
  {
    permission: 'inventory:audit',
    label: 'Inventory audit access',
    reason: 'review inventory audit trails',
    severity: 'high',
    category: 'inventory',
  },
  {
    permission: 'accounting:write',
    label: 'Write accounting records',
    reason: 'create or change accounting records',
    severity: 'critical',
    category: 'money',
  },
  {
    permission: 'reports:export',
    label: 'Export reports',
    reason: 'export financial, operational, or patient-related reports',
    severity: 'high',
    category: 'export',
  },
  {
    permission: 'pharmacy:narcotics',
    label: 'Controlled medicines register',
    reason: 'access controlled medicine workflows',
    severity: 'critical',
    category: 'pharmacy',
  },
  {
    permission: 'shareholders:delete',
    label: 'Delete shareholder records',
    reason: 'delete shareholder or ownership records',
    severity: 'critical',
    category: 'data',
  },
  {
    permission: 'patients:delete',
    label: 'Delete patient records',
    reason: 'delete patient records',
    severity: 'critical',
    category: 'data',
  },
  {
    permission: 'appointments:delete',
    label: 'Delete appointments',
    reason: 'delete appointment records',
    severity: 'high',
    category: 'data',
  },
] as const;

const CRITICAL_PERMISSION_MAP = new Map(
  CRITICAL_PERMISSIONS.map((definition) => [definition.permission, definition]),
);

const CRITICAL_PERMISSION_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /(^|[:._-])refund($|[:._-])/, reason: 'refund payments' },
  { pattern: /(^|[:._-])cancel($|[:._-])/, reason: 'cancel posted records' },
  { pattern: /(^|[:._-])delete($|[:._-])/, reason: 'delete or deactivate sensitive records' },
  { pattern: /(^|[:._-])discount($|[:._-])/, reason: 'grant or approve discounts' },
  { pattern: /(^|[:._-])approve($|[:._-])/, reason: 'approve sensitive workflows' },
  { pattern: /(^|[:._-])merge($|[:._-])/, reason: 'merge records' },
  { pattern: /(^|[:._-])discharge($|[:._-])/, reason: 'finalize patient discharges' },
  { pattern: /(^|[:._-])export($|[:._-])/, reason: 'export sensitive data' },
  { pattern: /(^|[:._-])backup($|[:._-])/, reason: 'request or download backup data' },
  { pattern: /(^|[:._-])adjust($|[:._-])|adjustment/, reason: 'adjust stock or financial records' },
];

export function getCriticalPermissionDefinition(permission: string): CriticalPermissionDefinition | null {
  return CRITICAL_PERMISSION_MAP.get(permission) ?? null;
}

export function getCriticalPermissionReason(permission: string): string | null {
  const exact = getCriticalPermissionDefinition(permission);
  if (exact) return exact.reason;

  const normalized = String(permission).toLowerCase();
  return CRITICAL_PERMISSION_PATTERNS.find(({ pattern }) => pattern.test(normalized))?.reason ?? null;
}

export function isCriticalPermission(permission: string): boolean {
  return getCriticalPermissionReason(permission) !== null;
}
