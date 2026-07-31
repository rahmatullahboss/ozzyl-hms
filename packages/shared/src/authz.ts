export const VALID_TENANT_ROLES = [
  'hospital_admin',
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

export type TenantRole = (typeof VALID_TENANT_ROLES)[number];

export const PLATFORM_ROLES = [
  'platform_admin',
  'platform_setup',
  'platform_support',
  'platform_auditor',
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];
export type AppRole = TenantRole | PlatformRole | 'super_admin';

const ROLE_ALIASES: Record<string, AppRole> = {
  doctor: 'doctor',
  nurse: 'nurse',
  laboratory: 'laboratory',
  lab: 'laboratory',
  lab_tech: 'laboratory',
  reception: 'reception',
  receptionist: 'reception',
  manager: 'manager',
  md: 'md',
  director: 'director',
  pharmacist: 'pharmacist',
  pharmacy: 'pharmacist',
  accountant: 'accountant',
  shareholder_viewer: 'shareholder_viewer',
  hospital_admin: 'hospital_admin',
  super_admin: 'super_admin',
  platform_admin: 'platform_admin',
  platform_setup: 'platform_setup',
  platform_support: 'platform_support',
  support: 'platform_support',
  platform_auditor: 'platform_auditor',
};

export const TENANT_ROLE_LABELS: Record<TenantRole, string> = {
  hospital_admin: 'Hospital Admin',
  doctor: 'Doctor',
  nurse: 'Nurse',
  laboratory: 'Laboratory Staff',
  reception: 'Reception',
  manager: 'Manager',
  md: 'CEO / Managing Director',
  director: 'Administration',
  pharmacist: 'Pharmacist',
  accountant: 'Accountant',
  shareholder_viewer: 'Shareholder Viewer',
};

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  platform_admin: 'Platform Admin',
  platform_setup: 'Platform Setup Staff',
  platform_support: 'Platform Support Staff',
  platform_auditor: 'Platform Auditor',
};

export const DEFAULT_ROLE_ROUTES: Record<TenantRole | PlatformRole | 'super_admin', string> = {
  super_admin: '/super-admin/dashboard',
  platform_admin: '/super-admin/dashboard',
  platform_setup: '/super-admin/dashboard',
  platform_support: '/super-admin/dashboard',
  platform_auditor: '/super-admin/dashboard',
  hospital_admin: 'dashboard',
  doctor: 'doctor/dashboard',
  nurse: 'nurse-station',
  laboratory: 'lab/dashboard',
  reception: 'reception/dashboard',
  manager: 'manager/dashboard',
  md: 'md/dashboard',
  director: 'director/dashboard',
  pharmacist: 'pharmacy/dashboard',
  accountant: 'accountant/dashboard',
  shareholder_viewer: 'shareholder/dashboard',
};

const RECEPTION_WORK_PERMISSIONS = [
  'dashboard:read',
  'patients:read', 'patients:write',
  'appointments:read', 'appointments:write',
  'telemedicine:read',
  'tests:read', 'tests:write',
  'billing:read', 'billing:write',
  'income:read', 'income:write',
  'expenses:read',
  'admissions:read', 'admissions:write', 'admissions:discharge',
  'beds:read', 'beds:write',
  'ip-billing:read',
  'ambulance:read', 'ambulance:write',
  'blood_bank:read', 'blood_bank:write',
  'billing.counter.read',
  'billing.counter.activate',
  'billing.counter.close',
  'billing.counter.handover.create',
  'billing.counter.handover.receive',
  'billing.counter.shift.read',
  'billing.counter.shift.close',
  'billing.counter.shift.handover.create',
  'billing.counter.shift.handover.receive',
  'billing.counter.shift.auto_open',
  'billing.counter.invoice.create',
];

const WORKFORCE_MANAGEMENT_PERMISSIONS = [
  'workforce:read', 'workforce:write', 'workforce:deactivate',
  'roster:read', 'roster:write', 'roster:swap', 'roster:cancel', 'roster:generate',
  'calendar:read', 'calendar:write',
  'attendance:read', 'attendance:write', 'attendance:correct',
  'leave:read', 'leave:request', 'leave:approve',
  'biometric:read', 'biometric:manage',
  'overtime:read', 'overtime:write', 'overtime:approve',
];

const ROLE_PERMISSIONS: Record<AppRole, string[]> = {
  super_admin: ['*'],
  platform_admin: [
    'platform:hospitals:read',
    'platform:hospitals:write',
    'platform:hospitals:delete',
    'platform:staff:manage',
    'platform:support:impersonate',
    'platform:audit:read',
  ],
  platform_setup: [
    'platform:hospitals:read',
    'platform:hospitals:write',
    'platform:support:impersonate',
  ],
  platform_support: [
    'platform:hospitals:read',
    'platform:support:impersonate',
  ],
  platform_auditor: [
    'platform:hospitals:read',
    'platform:audit:read',
  ],
  hospital_admin: ['*'],
  doctor: [
    'dashboard:read',
    'patients:read', 'patients:write',
    'appointments:read',
    'prescriptions:read', 'prescriptions:write',
    'tests:read', 'tests:write',
    'telemedicine:read',
    'nursing:read',
    'vitals:read',
    'reports:read',
    'schedule:read',
    'doctor:read',
  ],
  nurse: [
    'dashboard:read',
    'patients:read',
    'admissions:read',
    'nursing:read', 'nursing:write',
    'vitals:read', 'vitals:write',
    'medications:read',
    'inventory:read', 'inventory:consume',
  ],
  laboratory: [
    'dashboard:read',
    'tests:read', 'tests:write',
    'patients:read',
    'inventory:read', 'inventory:consume',
  ],
  reception: [
    ...RECEPTION_WORK_PERMISSIONS,
    'dashboard:read',
    'patients:read', 'patients:write',
    'appointments:read', 'appointments:write',
    'telemedicine:read',
    'tests:read', 'tests:write',
    'billing:read', 'billing:write',
    'income:read', 'income:write',
    'expenses:read',
    'admissions:read', 'admissions:write', 'admissions:discharge',
    'beds:read', 'beds:write',
    'ip-billing:read',
    'ambulance:read', 'ambulance:write',
    'blood_bank:read', 'blood_bank:write',
  ],
  pharmacist: [
    'dashboard:read',
    'pharmacy:read', 'pharmacy:write',
    'inventory:read', 'inventory:write', 'inventory:consume', 'inventory:transfer',
    'patients:read',
    'prescriptions:read',
  ],
  manager: [
    ...RECEPTION_WORK_PERMISSIONS,
    'receivables.view', 'receivables.followup.manage', 'receivables.write_off.request',
    'billing.counter.takeover',
    'dashboard:read',
    'manager.dashboard.read',
    'operations.overview.read',
    'operations.alerts.read',
    'operations.tasks.read',
    'operations.department_status.read',
    'tests:read',
    'tests:write',
  ],
  md: [
    ...RECEPTION_WORK_PERMISSIONS,
    'receivables.view', 'receivables.followup.manage', 'receivables.write_off.request', 'receivables.write_off.approve',
    'billing.counter.takeover',
    'dashboard:read',
    'manager.dashboard.read',
    'patients:read', 'patients:write',
    'telemedicine:read',
    'tests:read', 'tests:write',
    'billing:read', 'billing:write',
    'pharmacy:read', 'pharmacy:write',
    'inventory:read', 'inventory:write', 'inventory:adjust', 'inventory:approve',
    'inventory:reports', 'inventory:audit', 'inventory:assets', 'inventory:consume', 'inventory:transfer',
    'staff:read', 'staff:write', 'staff:delete',
    'hr:read', 'hr:write',
    ...WORKFORCE_MANAGEMENT_PERMISSIONS,
    'reports:read', 'reports:write',
    'accounting:read', 'accounting:write',
    'billing.counter.management_cash.read',
    'billing.counter.management_cash.receive',
    'billing.counter.management_cash.partial_collect',
    'income:read', 'income:write',
    'expenses:read', 'expenses:write', 'expenses.receipts.upload',
    'profit:calculate',
    'shareholders:read', 'shareholders:write',
    'settings:read', 'settings:write',
    'audit:read',
    'nursing:read',
    'schedule:read',
  ],
  director: [
    ...RECEPTION_WORK_PERMISSIONS,
    'receivables.view', 'receivables.followup.manage', 'receivables.write_off.request', 'receivables.write_off.approve',
    'billing.counter.takeover',
    'dashboard:read',
    'manager.dashboard.read',
    'patients:read', 'patients:write',
    'tests:read', 'tests:write',
    'billing:read', 'billing:write',
    'pharmacy:read', 'pharmacy:write',
    'inventory:read', 'inventory:write', 'inventory:adjust', 'inventory:approve',
    'inventory:reports', 'inventory:audit', 'inventory:assets', 'inventory:consume', 'inventory:transfer',
    'staff:read', 'staff:write', 'staff:delete',
    ...WORKFORCE_MANAGEMENT_PERMISSIONS,
    'reports:read', 'reports:write',
    'accounting:read', 'accounting:write',
    'billing.counter.management_cash.read',
    'billing.counter.management_cash.receive',
    'billing.counter.management_cash.partial_collect',
    'income:read', 'income:write',
    'expenses:read', 'expenses:write', 'expenses.receipts.upload',
    'profit:calculate', 'profit:approve',
    'shareholders:read', 'shareholders:write', 'shareholders:delete',
    'settings:read', 'settings:write',
    'audit:read',
  ],
  shareholder_viewer: [
    'shareholder_portal:read',
    'shareholder_portal:export',
  ],
  accountant: [
    'dashboard:read',
    'receivables.view', 'receivables.followup.manage', 'receivables.write_off.request',
    'billing:read',
    'billing.counter.takeover',
    'income:read', 'income:write',
    'expenses:read', 'expenses:write', 'expenses.receipts.upload',
    'accounting:read', 'accounting:write',
    'billing.counter.management_cash.read',
    'billing.counter.management_cash.receive',
    'billing.counter.management_cash.partial_collect',
    'inventory:read', 'inventory:reports', 'inventory:audit',
    'reports:read', 'reports:write',
    'audit:read',
  ],
};

export function normalizeRole(role: string | null | undefined): AppRole | '' {
  if (!role) return '';
  return ROLE_ALIASES[role] ?? ((VALID_TENANT_ROLES as readonly string[]).includes(role) ? (role as AppRole) : '');
}

export function getPermissionsForRole(role: string | null | undefined): string[] {
  const normalized = normalizeRole(role);
  return normalized ? [...(ROLE_PERMISSIONS[normalized] ?? [])] : [];
}

export function isRoleAllowed(userRole: string | null | undefined, allowedRoles: readonly string[]): boolean {
  const normalizedUserRole = normalizeRole(userRole);
  if (!normalizedUserRole) return false;
  return allowedRoles.some((allowedRole) => normalizeRole(allowedRole) === normalizedUserRole);
}

// ─── Expanded Permission Catalog (for admin UI) ────────────────────────────

export const ALL_PERMISSIONS = [
  // Dashboard
  'dashboard:read',
  // Patients
  'patients:read', 'patients:write', 'patients:delete',
  'patients:demographics', 'patients:clinical', 'patients:billing_info',
  // Appointments
  'appointments:read', 'appointments:write', 'appointments:delete',
  // Prescriptions
  'prescriptions:read', 'prescriptions:write',
  // Tests / Lab
  'tests:read', 'tests:write', 'tests:verify',
  'lab_machines:read', 'lab_machines:write',
  // Billing & Finance
  'billing:read', 'billing:write', 'billing:cancel', 'billing:refund',
  'receivables.view', 'receivables.followup.manage',
  'receivables.write_off.request', 'receivables.write_off.approve', 'receivables.write_off.audit',
  'billing.counter.read', 'billing.counter.activate', 'billing.counter.close',
  'billing.counter.cash_movement', 'billing.counter.cash_drop',
  'billing.counter.handover.create', 'billing.counter.handover.receive',
  'billing.counter.shift.read', 'billing.counter.shift.close',
  'billing.counter.shift.handover.create', 'billing.counter.shift.handover.receive',
  'billing.counter.shift.auto_open',
  'billing.counter.management_cash.read', 'billing.counter.management_cash.receive',
  'billing.counter.management_cash.partial_collect', 'billing.counter.management_cash.dispute',
  'billing.counter.bank_deposit.create', 'billing.counter.bank_deposit.approve',
  'billing.counter.force_close', 'billing.counter.takeover',
  'billing.counter.discount.approve', 'billing.counter.variance.approve',
  'billing.counter.invoice.create', 'billing.counter.invoice.discount',
  'income:read', 'income:write',
  'expenses:read', 'expenses:write', 'expenses.receipts.upload',
  // Pharmacy
  'pharmacy:read', 'pharmacy:write', 'pharmacy:dispense', 'pharmacy:narcotics',
  // Nursing
  'nursing:read', 'nursing:write', 'nursing:mar', 'nursing:io_charts',
  // Vitals
  'vitals:read', 'vitals:write',
  // Admissions / IPD
  'admissions:read', 'admissions:write', 'admissions:discharge',
  // Beds
  'beds:read',
  // IP Billing
  'ip-billing:read',
  // Operations
  'ot:read', 'ot:write',
  'emergency:read', 'emergency:write',
  // Ambulance & Blood Bank
  'ambulance:read', 'ambulance:write',
  'blood_bank:read', 'blood_bank:write',
  // Radiology
  'radiology:read', 'radiology:write',
  // Telemedicine
  'telemedicine:read', 'telemedicine:write',
  // Medications
  'medications:read', 'medications:write',
  // HR / Workforce
  'hr:read', 'hr:write',
  'staff:read', 'staff:write', 'staff:delete',
  ...WORKFORCE_MANAGEMENT_PERMISSIONS,
  // Inventory
  'inventory:read', 'inventory:write', 'inventory:approve', 'inventory:adjust',
  'inventory:reports', 'inventory:audit', 'inventory:assets', 'inventory:consume', 'inventory:transfer',
  // Accounting
  'accounting:read', 'accounting:write',
  'profit:calculate', 'profit:approve',
  'shareholders:read', 'shareholders:write', 'shareholders:delete',
  'shareholder_portal:read', 'shareholder_portal:export',
  // Reports
  'reports:read', 'reports:write', 'reports:export',
  // Settings & Admin
  'settings:read', 'settings:write',
  'audit:read',
  'users:read', 'users:write', 'users:delete',
  'roles:manage',
  // Platform operations
  'platform:hospitals:read', 'platform:hospitals:write', 'platform:hospitals:delete',
  'platform:staff:manage', 'platform:support:impersonate', 'platform:audit:read',
  // Schedule
  'schedule:read', 'schedule:write',
  // Clinical
  'clinical_reminders:read', 'clinical_reminders:write',
  'clinical_forms:read', 'clinical_forms:write',
  'allergies:read', 'allergies:write',
  // Doctor management
  'doctor:read', 'doctor:write',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export interface WorkspaceBundle {
  id: string;
  label: string;
  description: string;
  permissions: readonly string[];
}

export type WorkspaceLevelValue = 'off' | 'view' | 'operate' | 'approve' | 'admin';

export interface WorkspaceLevelOption {
  level: WorkspaceLevelValue;
  label: string;
  description: string;
  permissions: readonly string[];
}

export interface WorkspaceLevelGroup {
  id: string;
  label: string;
  description: string;
  options: readonly WorkspaceLevelOption[];
  criticalPermissions?: readonly string[];
}

export const WORKSPACE_BUNDLES: WorkspaceBundle[] = [
  {
    id: 'reception-desk',
    label: 'Reception Desk',
    description: 'Patients, appointments, billing counter and basic report delivery for front-desk work.',
    permissions: [
      'dashboard:read',
      'patients:read',
      'patients:write',
      'appointments:read',
      'appointments:write',
      'billing:read',
      'billing:write',
      'billing.counter.read',
      'billing.counter.activate',
      'billing.counter.close',
      'billing.counter.handover.receive',
      'billing.counter.shift.auto_open',
      'tests:read',
    ],
  },
  {
    id: 'reception-counter-operator',
    label: 'Reception Counter Operator',
    description: 'Operate billing counter shifts, accept handovers, close counters and create counter invoices.',
    permissions: [
      'dashboard:read', 'billing:read', 'billing:write',
      'billing.counter.read', 'billing.counter.activate', 'billing.counter.close',
      'billing.counter.handover.create', 'billing.counter.handover.receive',
      'billing.counter.shift.read', 'billing.counter.shift.close',
      'billing.counter.shift.handover.create', 'billing.counter.shift.handover.receive',
      'billing.counter.shift.auto_open', 'billing.counter.invoice.create',
    ],
  },
  {
    id: 'management-cash-receiver',
    label: 'Management Cash Receiver',
    description: 'Receive management cash handovers without starting a reception counter shift.',
    permissions: [
      'dashboard:read', 'billing:read', 'accounting:read',
      'billing.counter.management_cash.read', 'billing.counter.management_cash.receive',
      'billing.counter.management_cash.partial_collect',
    ],
  },
  {
    id: 'cash-operations',
    label: 'Cash Operations',
    description: 'Cash counter, bill collection visibility, income and expense read access.',
    permissions: [
      'dashboard:read',
      'billing:read',
      'billing:write',
      'income:read',
      'expenses:read',
    ],
  },
  {
    id: 'management',
    label: 'Management',
    description: 'Management workspace with staff visibility, accounting write access, cash-receive permissions, income/expense visibility and reports.',
    permissions: [
      'staff:read',
      'accounting:read',
      'accounting:write',
      'billing.counter.management_cash.read',
      'billing.counter.management_cash.receive',
      'billing.counter.management_cash.partial_collect',
      'income:read',
      'expenses:read',
      'reports:read',
    ],
  },
  {
    id: 'accountant-workspace',
    label: 'Accountant Workspace',
    description: 'Accounting dashboard, cash book, income, expense, settlements and reports.',
    permissions: ['dashboard:read', 'accounting:read', 'accounting:write', 'income:read', 'income:write', 'expenses:read', 'expenses:write', 'billing:read', 'billing.counter.management_cash.read', 'reports:read'],
  },
  {
    id: 'doctor-management',
    label: 'Doctor Management',
    description: 'Manage doctor profiles, schedules and doctor setup.',
    permissions: ['dashboard:read', 'doctor:read', 'doctor:write', 'schedule:read', 'schedule:write', 'reports:read'],
  },
  {
    id: 'hr-staff-management',
    label: 'HR and Staff Management',
    description: 'Manage staff profiles and HR records.',
    permissions: ['dashboard:read', 'staff:read', 'staff:write', 'hr:read', 'hr:write'],
  },
  {
    id: 'laboratory-workspace',
    label: 'Laboratory Workspace',
    description: 'Lab dashboard, test processing and lab machine work.',
    permissions: ['dashboard:read', 'tests:read', 'tests:write', 'tests:verify', 'lab_machines:read'],
  },
  {
    id: 'pharmacy-workspace',
    label: 'Pharmacy Workspace',
    description: 'Pharmacy dashboard, dispensing and inventory consumption.',
    permissions: ['dashboard:read', 'pharmacy:read', 'pharmacy:write', 'pharmacy:dispense', 'inventory:read', 'inventory:consume'],
  },
  {
    id: 'inventory-operator',
    label: 'Inventory Operator',
    description: 'Inventory stock, movement, transfers and operational reports.',
    permissions: ['dashboard:read', 'inventory:read', 'inventory:write', 'inventory:transfer', 'inventory:reports'],
  },
  {
    id: 'inventory-supervisor',
    label: 'Inventory Supervisor',
    description: 'Inventory supervision workspace. Approval, audit and stock adjustment stay as separate critical grants.',
    permissions: ['dashboard:read', 'inventory:read', 'inventory:write', 'inventory:transfer', 'inventory:reports'],
  },
  {
    id: 'reports',
    label: 'Reports & Analytics',
    description: 'Operational and financial report viewing without settings or role-management access.',
    permissions: [
      'dashboard:read',
      'reports:read',
    ],
  },
];

export const WORKSPACE_LEVEL_GROUPS: WorkspaceLevelGroup[] = [
  {
    id: 'inventory',
    label: 'Inventory',
    description: 'Stock visibility, entry, transfer, approval and audit access. Stock adjustment stays separate as a critical permission.',
    criticalPermissions: ['inventory:adjust', 'inventory:approve', 'inventory:audit'],
    options: [
      {
        level: 'off',
        label: 'Off',
        description: 'No inventory workspace access from this level control.',
        permissions: [],
      },
      {
        level: 'view',
        label: 'View',
        description: 'Can see stock position and inventory reports only.',
        permissions: ['inventory:read', 'inventory:reports'],
      },
      {
        level: 'operate',
        label: 'Operate',
        description: 'Can enter stock work, transfer stock and view operational reports.',
        permissions: ['inventory:read', 'inventory:write', 'inventory:transfer', 'inventory:reports'],
      },
      {
        level: 'approve',
        label: 'Approve',
        description: 'Can supervise inventory entries, approvals and audit review. Does not include stock adjustment.',
        permissions: ['inventory:read', 'inventory:write', 'inventory:transfer', 'inventory:reports', 'inventory:assets'],
      },
      {
        level: 'admin',
        label: 'Admin',
        description: 'Can administer inventory operations, assets, consumption rules, transfers, reports, approvals and audit. Does not include stock adjustment.',
        permissions: ['inventory:read', 'inventory:write', 'inventory:transfer', 'inventory:reports', 'inventory:assets', 'inventory:consume'],
      },
    ],
  },
];

export function getWorkspaceBundle(bundleId: string): WorkspaceBundle | undefined {
  return WORKSPACE_BUNDLES.find((bundle) => bundle.id === bundleId);
}

export function getMissingWorkspaceBundlePermissions(
  bundle: WorkspaceBundle,
  effectivePermissions: readonly string[],
): string[] {
  if (effectivePermissions.includes('*')) return [];
  const effectiveSet = new Set(effectivePermissions);
  return bundle.permissions.filter((permission) => !effectiveSet.has(permission));
}

export function isWorkspaceBundleGranted(
  bundle: WorkspaceBundle,
  effectivePermissions: readonly string[],
): boolean {
  return getMissingWorkspaceBundlePermissions(bundle, effectivePermissions).length === 0;
}

export function getWorkspaceLevelGroup(groupId: string): WorkspaceLevelGroup | undefined {
  return WORKSPACE_LEVEL_GROUPS.find((group) => group.id === groupId);
}

export function getWorkspaceLevelOption(
  group: WorkspaceLevelGroup,
  level: WorkspaceLevelValue,
): WorkspaceLevelOption | undefined {
  return group.options.find((option) => option.level === level);
}

export function getWorkspaceLevelManagedPermissions(group: WorkspaceLevelGroup): string[] {
  return [...new Set(group.options.flatMap((option) => option.permissions))];
}

export function getWorkspaceLevelForPermissions(
  group: WorkspaceLevelGroup,
  effectivePermissions: readonly string[],
): WorkspaceLevelOption {
  const permissionSet = new Set(effectivePermissions);
  const offOption = group.options.find((option) => option.level === 'off') ?? group.options[0];
  if (permissionSet.has('*')) {
    return group.options[group.options.length - 1] ?? offOption;
  }

  let current = offOption;
  for (const option of group.options) {
    if (option.level === 'off') continue;
    if (option.permissions.every((permission) => permissionSet.has(permission))) {
      current = option;
    }
  }
  return current;
}

export function getWorkspaceLevelPermissionDelta(
  group: WorkspaceLevelGroup,
  level: WorkspaceLevelValue,
  effectivePermissions: readonly string[],
): { targetPermissions: string[]; addPermissions: string[]; dropPermissions: string[] } {
  const option = getWorkspaceLevelOption(group, level);
  if (!option) {
    return { targetPermissions: [], addPermissions: [], dropPermissions: [] };
  }
  const effectiveSet = new Set(effectivePermissions);
  const targetSet = new Set(option.permissions);
  const managedPermissions = getWorkspaceLevelManagedPermissions(group);
  return {
    targetPermissions: [...targetSet],
    addPermissions: [...targetSet].filter((permission) => !effectiveSet.has(permission)),
    dropPermissions: managedPermissions.filter((permission) => !targetSet.has(permission) && effectiveSet.has(permission)),
  };
}

export const PERMISSION_GROUPS: Record<string, { label: string; permissions: string[] }> = {
  dashboard: { label: 'Dashboard', permissions: ['dashboard:read'] },
  patients: { label: 'Patient Management', permissions: ['patients:read', 'patients:write', 'patients:delete', 'patients:demographics', 'patients:clinical', 'patients:billing_info'] },
  appointments: { label: 'Appointments', permissions: ['appointments:read', 'appointments:write', 'appointments:delete'] },
  prescriptions: { label: 'Prescriptions', permissions: ['prescriptions:read', 'prescriptions:write'] },
  lab: { label: 'Laboratory', permissions: ['tests:read', 'tests:write', 'tests:verify', 'lab_machines:read', 'lab_machines:write'] },
  billing: {
    label: 'Billing & Finance',
    permissions: [
      'billing:read', 'billing:write', 'billing:cancel', 'billing:refund',
      'billing.counter.read', 'billing.counter.activate', 'billing.counter.close',
      'billing.counter.cash_movement', 'billing.counter.cash_drop',
      'billing.counter.handover.create', 'billing.counter.handover.receive',
      'billing.counter.shift.read', 'billing.counter.shift.close',
      'billing.counter.shift.handover.create', 'billing.counter.shift.handover.receive',
      'billing.counter.shift.auto_open',
      'billing.counter.management_cash.read', 'billing.counter.management_cash.receive',
      'billing.counter.management_cash.partial_collect', 'billing.counter.management_cash.dispute',
      'billing.counter.bank_deposit.create', 'billing.counter.bank_deposit.approve',
      'billing.counter.force_close', 'billing.counter.takeover',
      'billing.counter.discount.approve', 'billing.counter.variance.approve',
      'billing.counter.invoice.create', 'billing.counter.invoice.discount',
      'income:read', 'income:write', 'expenses:read', 'expenses:write', 'expenses.receipts.upload',
    ],
  },
  pharmacy: { label: 'Pharmacy', permissions: ['pharmacy:read', 'pharmacy:write', 'pharmacy:dispense', 'pharmacy:narcotics'] },
  nursing: { label: 'Nursing', permissions: ['nursing:read', 'nursing:write', 'nursing:mar', 'nursing:io_charts', 'vitals:read', 'vitals:write'] },
  ipd: { label: 'IPD / Admissions', permissions: ['admissions:read', 'admissions:write', 'admissions:discharge'] },
  operations: { label: 'Operations', permissions: ['ot:read', 'ot:write', 'emergency:read', 'emergency:write'] },
  ambulance_bloodbank: { label: 'Ambulance & Blood Bank', permissions: ['ambulance:read', 'ambulance:write', 'blood_bank:read', 'blood_bank:write'] },
  radiology: { label: 'Radiology', permissions: ['radiology:read', 'radiology:write'] },
  telemedicine: { label: 'Telemedicine', permissions: ['telemedicine:read', 'telemedicine:write'] },
  hr: {
    label: 'HR & Staff',
    permissions: ['hr:read', 'hr:write', 'staff:read', 'staff:write', 'staff:delete', ...WORKFORCE_MANAGEMENT_PERMISSIONS],
  },
  inventory: {
    label: 'Inventory',
    permissions: [
      'inventory:read', 'inventory:write', 'inventory:approve', 'inventory:adjust',
      'inventory:reports', 'inventory:audit', 'inventory:assets', 'inventory:consume', 'inventory:transfer',
    ],
  },
  accounting: { label: 'Accounting', permissions: ['accounting:read', 'accounting:write', 'profit:calculate', 'profit:approve', 'shareholders:read', 'shareholders:write', 'shareholders:delete'] },
  shareholder_portal: { label: 'Shareholder Portal', permissions: ['shareholder_portal:read', 'shareholder_portal:export'] },
  reports: { label: 'Reports', permissions: ['reports:read', 'reports:write', 'reports:export'] },
  admin: { label: 'Administration', permissions: ['settings:read', 'settings:write', 'audit:read', 'users:read', 'users:write', 'users:delete', 'roles:manage'] },
  clinical: { label: 'Clinical Tools', permissions: ['clinical_reminders:read', 'clinical_reminders:write', 'clinical_forms:read', 'clinical_forms:write', 'allergies:read', 'allergies:write', 'medications:read', 'medications:write'] },
  schedule: { label: 'Schedule', permissions: ['schedule:read', 'schedule:write'] },
  doctor_management: { label: 'Doctor Management', permissions: ['doctor:read', 'doctor:write'] },
};

/** Modules list for sidebar visibility control */
export const ALL_MODULES = [
  'dashboard', 'patients', 'appointments', 'pharmacy', 'lab', 'billing',
  'nursing', 'ipd', 'ot', 'emergency', 'radiology', 'telemedicine',
  'hr', 'inventory', 'accounting', 'reports', 'settings', 'ambulance', 'bloodBank',
] as const;

export type ModuleKey = (typeof ALL_MODULES)[number];

export const MODULE_PERMISSION_MAP: Record<ModuleKey, readonly string[]> = {
  dashboard: PERMISSION_GROUPS.dashboard.permissions,
  patients: PERMISSION_GROUPS.patients.permissions,
  appointments: PERMISSION_GROUPS.appointments.permissions,
  pharmacy: PERMISSION_GROUPS.pharmacy.permissions,
  lab: PERMISSION_GROUPS.lab.permissions,
  billing: PERMISSION_GROUPS.billing.permissions,
  nursing: PERMISSION_GROUPS.nursing.permissions,
  ipd: PERMISSION_GROUPS.ipd.permissions,
  ot: ['ot:read', 'ot:write'],
  emergency: ['emergency:read', 'emergency:write'],
  radiology: PERMISSION_GROUPS.radiology.permissions,
  telemedicine: PERMISSION_GROUPS.telemedicine.permissions,
  hr: PERMISSION_GROUPS.hr.permissions,
  inventory: PERMISSION_GROUPS.inventory.permissions,
  accounting: PERMISSION_GROUPS.accounting.permissions,
  reports: PERMISSION_GROUPS.reports.permissions,
  settings: PERMISSION_GROUPS.admin.permissions,
  ambulance: ['ambulance:read', 'ambulance:write'],
  bloodBank: ['blood_bank:read', 'blood_bank:write'],
};

export function getPermissionsForModule(module: string): string[] {
  return [...(MODULE_PERMISSION_MAP[module as ModuleKey] ?? [])];
}

// ═══════════════════════════════════════════════════════════════════════════════
// fix/portal-consent — P0-33: MPI guardian/alias/verify permissions (P0-33)
// ═══════════════════════════════════════════════════════════════════════════════
// These are appended to ALL_PERMISSIONS so they show up in the admin
// permission UI. The route layer enforces them via requirePermission(...).
// 'mpi.guardian.add', 'mpi.guardian.remove', 'mpi.guardian.update',
// 'mpi.alias.add', 'mpi.alias.remove', 'mpi.verify', 'hospitalLinks.verify'
