import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Shield, Search, X, RefreshCw, AlertCircle, Check, XCircle,
  ChevronDown, ChevronRight, RotateCcw, Save, Users,
  UserCog, Grid3X3, Lock, AlertTriangle, UserPlus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { useCurrentUserAccess } from '../hooks/useCurrentUserAccess';
import { api } from '../lib/apiClient';
import { queryKeys } from '../lib/queryKeys';
import {
  WORKSPACE_BUNDLES,
  WORKSPACE_LEVEL_GROUPS,
  getMissingWorkspaceBundlePermissions,
  getWorkspaceLevelForPermissions,
  getWorkspaceLevelPermissionDelta,
  isWorkspaceBundleGranted,
  type WorkspaceLevelValue,
} from '../lib/workspaceBundles';
import { getWorkspaceAccessPreview } from '../lib/workspaceAccessPreview';
import {
  buildModuleVisibilityConfirmation,
  getModuleVisibilityAffectedPermissions,
  isProtectedModuleVisibilityRole,
} from '../lib/moduleVisibilitySafety';
import {
  buildRoleMatrixSaveConfirmation,
  getPermissionDiff,
  isProtectedRoleMatrixRole,
} from '../lib/roleMatrixSafety';
import { getCriticalPermissionDefinition, getCriticalPermissionReason, isCriticalPermission } from '@shared/criticalPermissions';

/* ─── Types ─── */
interface PermissionGroup {
  label: string;
  permissions: string[];
}

interface RoleDef {
  role: string;
  label: string;
}

interface PermissionCatalog {
  all_permissions: string[];
  groups: Record<string, PermissionGroup>;
  roles: RoleDef[];
}

interface RoleMatrixEntry {
  role: string;
  label: string;
  permissions: string[];
  is_customized: boolean;
}

interface UserOverride {
  permission: string;
  action: 'grant' | 'revoke';
  reason?: string;
  granted_by?: string;
  created_at?: string;
}

interface UserPermissionData {
  user: { id: number; name: string; email: string; role: string };
  role_permissions: string[];
  user_overrides: UserOverride[];
  effective_permissions: string[];
}

interface StaffMember {
  id: number;
  user_id?: number | string | null;
  name: string;
  email?: string | null;
  role?: string | null;
  position?: string | null;
  pending_invitation_status?: string | null;
  effective_permissions_count?: number | null;
  critical_permissions_count?: number | null;
  active_workspaces?: string[];
  access_summary_error?: boolean;
  access_summary_error_message?: string | null;
}

interface ModuleVisibility {
  role: string;
  module: string;
  is_visible: boolean;
}

const MODULES = [
  'dashboard', 'patients', 'appointments', 'pharmacy', 'lab', 'billing',
  'nursing', 'ipd', 'ot', 'emergency', 'radiology', 'telemedicine',
  'hr', 'inventory', 'accounting', 'reports', 'settings',
];

// Module labels are now handled via translation keys in permissions.json

const TABS = ['roles', 'users', 'modules'] as const;
type TabId = typeof TABS[number];

function confirmCriticalPermission(permission: string): boolean {
  const reason = getCriticalPermissionReason(permission);
  if (!reason) return true;
  return window.confirm(
    `Critical permission warning\n\nEnabling "${permission.replace(/_/g, ' ')}" may allow this role to ${reason}.\n\nAllow this permission?`,
  );
}

interface WorkAreaCopy {
  label: string;
  description: string;
  examples: string[];
}

const WORK_AREA_COPY: Record<string, WorkAreaCopy> = {
  'reception-desk': { label: 'Reception Desk', description: 'Front-desk work for registration, appointment, basic billing and report delivery.', examples: ['Register patients', 'Book appointments', 'Create basic bills'] },
  'reception-counter-operator': { label: 'Billing Counter Operator', description: 'Daily cash counter operation without full accounting/admin access.', examples: ['Open/close counter', 'Receive patient payments', 'Hand over counter cash'] },
  'management-cash-receiver': { label: 'Management Cash Receiver', description: 'Receive cash handovers from reception and counter teams.', examples: ['Receive cash handover', 'Partially collect cash', 'View management cash'] },
  'cash-operations': { label: 'Cash Operations', description: 'Basic income/expense visibility and counter collection work.', examples: ['See cash collections', 'Work with billing', 'View basic expenses'] },
  management: { label: 'Management Workspace', description: 'Operational management view for reports, cash handover and staff oversight.', examples: ['View reports', 'Monitor operations', 'Receive management cash'] },
  'accountant-workspace': { label: 'Accountant Workspace', description: 'Accounting, income, expenses, settlements and finance reports.', examples: ['Manage accounts', 'Record income/expenses', 'View finance reports'] },
  'doctor-management': { label: 'Doctor Management', description: 'Manage doctor profiles, schedules and setup.', examples: ['Manage doctor profiles', 'Update schedules', 'View doctor reports'] },
  'hr-staff-management': { label: 'HR & Staff Management', description: 'Manage staff profiles and HR records.', examples: ['Add staff', 'Update staff info', 'Manage HR records'] },
  'laboratory-workspace': { label: 'Laboratory Workspace', description: 'Lab dashboard, test processing and machine-related work.', examples: ['Process tests', 'Verify lab work', 'View lab dashboard'] },
  'pharmacy-workspace': { label: 'Pharmacy Workspace', description: 'Pharmacy sale, dispensing and stock consumption work.', examples: ['Dispense medicine', 'Work with pharmacy stock', 'View prescriptions'] },
  'inventory-operator': { label: 'Inventory Operator', description: 'Stock, movement, transfers and inventory reports.', examples: ['Manage stock', 'Transfer inventory', 'View stock reports'] },
  reports: { label: 'Reports & Analytics', description: 'Operational and financial report viewing without settings access.', examples: ['View reports', 'Monitor performance', 'Review analytics'] },
};

function getWorkAreaCopy(bundle: (typeof WORKSPACE_BUNDLES)[number]): WorkAreaCopy {
  return WORK_AREA_COPY[bundle.id] ?? { label: bundle.label, description: bundle.description, examples: ['Access related pages', 'Perform assigned work', 'View relevant dashboard'] };
}

const ASSIGNABLE_WORKSPACE_BUNDLES = WORKSPACE_BUNDLES.map((bundle) => ({
  ...bundle,
  permissions: bundle.id === 'management'
    ? bundle.permissions.filter((permission) => !isCriticalPermission(permission))
    : [...bundle.permissions],
}));

function formatPermissionLabel(permission: string): string {
  const definition = getCriticalPermissionDefinition(permission);
  if (definition) return definition.label;
  return permission.replace(/_/g, ' ').replace(/[.:]/g, ' › ').replace(/\b\w/g, c => c.toUpperCase());
}

function getRiskSummary(permissions: readonly string[]): Array<{ permission: string; label: string; reason: string; severity: string; category: string }> {
  const unique = [...new Set(permissions.filter(isCriticalPermission))];
  return unique.map((permission) => {
    const definition = getCriticalPermissionDefinition(permission);
    return {
      permission,
      label: definition?.label ?? formatPermissionLabel(permission),
      reason: definition?.reason ?? getCriticalPermissionReason(permission) ?? 'sensitive access',
      severity: definition?.severity ?? 'high',
      category: definition?.category ?? 'access',
    };
  }).sort((a, b) => (a.severity === b.severity ? a.label.localeCompare(b.label) : a.severity === 'critical' ? -1 : 1));
}

/* ─── Helpers ─── */
function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {[...Array(4)].map((_, i) => (
        <tr key={i}>
          {[...Array(cols)].map((_, j) => (
            <td key={j}><div className="skeleton h-4 w-full rounded" /></td>
          ))}
        </tr>
      ))}
    </>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className={`bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800 z-10">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ─── Tab 1: Role Permissions Matrix ─── */
function RolePermissionsTab() {
  const { t } = useTranslation(['permissions', 'common']);
  const queryClient = useQueryClient();
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [editPerms, setEditPerms] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);

  const { data: catalogRaw, isLoading: catalogLoading, isError: catalogError, refetch: refetchCatalog } = useApiQuery<any>(
    queryKeys.permissions.catalog(),
    '/api/permissions/catalog',
  );
  const { data: matrixRaw, isLoading: matrixLoading, isError: matrixError, refetch: refetchMatrix } = useApiQuery<any>(
    queryKeys.permissions.matrix(),
    '/api/permissions/matrix',
  );

  const catalog: PermissionCatalog | null = catalogRaw?.data ?? catalogRaw ?? null;
  const matrix: Record<string, RoleMatrixEntry> = matrixRaw?.data?.matrix ?? matrixRaw?.matrix ?? matrixRaw?.data ?? matrixRaw ?? {};
  const loading = catalogLoading || matrixLoading;
  const error = catalogError || matrixError;

  const reload = () => { refetchCatalog(); refetchMatrix(); };

  const saveMutation = useApiMutation<any, any>('put', '/api/permissions/role', {
    onSuccess: () => {
      toast.success(t('roleMatrix.saveSuccess'));
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.permissions.all });
    },
    onError: (err) => { toast.error(err.message || t('roleMatrix.saveError')); },
  });

  const resetMutation = useApiMutation<any, { role: string }>('delete', (vars) => `/api/permissions/role/${vars.role}`, {
    onSuccess: () => {
      toast.success(t('actions.reset') + ' ' + t('common:statuses.success'));
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.permissions.all });
    },
    onError: (err) => { toast.error(err.message || t('common:operationFailed')); },
  });

  const selectRole = useCallback((role: string) => {
    setSelectedRole(role);
    const entry = matrix[role];
    setEditPerms(new Set(entry?.permissions ?? []));
    setDirty(false);
    if (catalog) {
      setExpandedGroups(new Set(Object.keys(catalog.groups)));
    }
  }, [matrix, catalog]);

  const togglePermission = useCallback((perm: string) => {
    if (selectedRole && isProtectedRoleMatrixRole(selectedRole)) return;
    if (!editPerms.has(perm) && !confirmCriticalPermission(perm)) return;
    setEditPerms(prev => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm); else next.add(perm);
      return next;
    });
    setDirty(true);
  }, [editPerms, selectedRole]);

  const toggleGroup = useCallback((groupKey: string) => {
    if (selectedRole && isProtectedRoleMatrixRole(selectedRole)) return;
    if (!catalog) return;
    const group = catalog.groups[groupKey];
    if (!group) return;
    const allSelected = group.permissions.every(p => editPerms.has(p));
    if (!allSelected) {
      const criticalPermission = group.permissions.find((permission) => !editPerms.has(permission) && getCriticalPermissionReason(permission));
      if (criticalPermission && !confirmCriticalPermission(criticalPermission)) return;
    }
    setEditPerms(prev => {
      const next = new Set(prev);
      group.permissions.forEach(p => {
        if (allSelected) next.delete(p); else next.add(p);
      });
      return next;
    });
    setDirty(true);
  }, [catalog, editPerms, selectedRole]);

  const toggleGroupExpand = useCallback((groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
      return next;
    });
  }, []);

  const handleSave = async () => {
    if (!selectedRole || isProtectedRoleMatrixRole(selectedRole)) return;
    const currentPermissions = matrix[selectedRole]?.permissions ?? [];
    const nextPermissions = Array.from(editPerms);
    const diff = getPermissionDiff(currentPermissions, nextPermissions);
    if (diff.added.length === 0 && diff.removed.length === 0) return;

    const criticalAdded = diff.added.filter(isCriticalPermission);
    let reason: string | undefined;
    if (criticalAdded.length > 0) {
      reason = window.prompt(`Why should this role receive critical access?\n\n${criticalAdded.join('\n')}`)?.trim();
      if (!reason || reason.length < 5) {
        toast.error('A clear reason is required for critical permission grants.');
        return;
      }
    }

    const impact = await api.get<{ active_user_count: number }>(`/api/permissions/role/${selectedRole}/impact`).catch(() => ({ active_user_count: 0 }));
    const roleLabel = matrix[selectedRole]?.label ?? selectedRole;
    const confirmation = `${buildRoleMatrixSaveConfirmation({ roleLabel, ...diff })}\n\nThis change affects ${impact.active_user_count} active user(s).`;
    if (!confirm(confirmation)) return;
    saveMutation.mutate({
      role: selectedRole,
      permissions: nextPermissions,
      reason,
      confirmation: criticalAdded.length > 0,
    });
  };

  const handleReset = async () => {
    if (!selectedRole || isProtectedRoleMatrixRole(selectedRole)) return;
    if (!confirm(t('userOverrides.deleteConfirm'))) return;
    resetMutation.mutate({ role: selectedRole });
  };

  // Sync edit perms when matrix updates
  useEffect(() => {
    if (selectedRole && matrix[selectedRole]) {
      setEditPerms(new Set(matrix[selectedRole].permissions));
    }
  }, [matrixRaw]);

  if (error) {
    return (
      <div className="card p-8 text-center">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="text-[var(--color-text-secondary)] mb-3">{t('common:errorLoading')}</p>
        <button onClick={reload} className="btn-primary"><RefreshCw className="w-4 h-4" /> {t('common:retry')}</button>
      </div>
    );
  }

  if (loading || !catalog) {
    return (
      <div className="card overflow-hidden">
        <table className="table-base"><tbody><SkeletonRows cols={4} /></tbody></table>
      </div>
    );
  }

  const roles = catalog.roles;
  const selectedRoleProtected = selectedRole ? isProtectedRoleMatrixRole(selectedRole) : false;

  return (
    <div className="flex flex-col lg:flex-row gap-5">
      {/* Role list */}
      <div className={`${selectedRole ? 'lg:w-1/3' : 'w-full'} space-y-4 transition-all`}>
        <h2 className="font-semibold text-lg">Roles</h2>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('userOverrides.selectModule')}</th>
                  <th>{t('roleMatrix.title')}</th>
                  <th>{t('common:status')}</th>
                </tr>
              </thead>
              <tbody>
                {roles.length === 0 ? (
                  <tr>
                    <td colSpan={3}>
                      <EmptyState
                        icon={<Shield className="w-8 h-8 text-[var(--color-text-muted)]" />}
                        title={t('common:noData')}
                        description={t('roleMatrix.subtitle')}
                      />
                    </td>
                  </tr>
                ) : roles.map(r => {
                  const entry = matrix[r.role];
                  const permCount = entry?.permissions?.length ?? 0;
                  const isCustomized = entry?.is_customized ?? false;
                  return (
                    <tr
                      key={r.role}
                      className={`cursor-pointer transition-colors ${selectedRole === r.role ? 'bg-[var(--color-primary)]/5' : 'hover:bg-[var(--color-border-light)]'}`}
                      onClick={() => selectRole(r.role)}
                    >
                      <td className="font-medium">{r.label}</td>
                      <td className="text-sm text-[var(--color-text-secondary)]">{permCount} {t('roleMatrix.title')}</td>
                      <td>
                        <span className={`badge ${isCustomized ? 'badge-warning' : 'badge-success'}`}>
                          {isCustomized ? t('status.override') : t('status.global')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Permission editor panel */}
      {selectedRole && (
        <div className="lg:w-2/3 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-lg">
                {matrix[selectedRole]?.label ?? selectedRole}
              </h2>
              <p className="text-sm text-[var(--color-text-secondary)]">
                {editPerms.size} {t('roleMatrix.title')} {t('common:selected')}
                {dirty && <span className="ml-2 text-amber-500 font-medium">{t('roleMatrix.globalToggle', { role: '' }).replace('Toggle all for', '(unsaved)')}</span>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleReset}
                disabled={resetMutation.isPending || selectedRoleProtected}
                className="btn-secondary text-sm"
              >
                <RotateCcw className={`w-4 h-4 ${resetMutation.isPending ? 'animate-spin' : ''}`} />
                {t('actions.reset')}
              </button>
              <button onClick={() => setSelectedRole(null)} className="btn-ghost p-1.5">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {selectedRoleProtected && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900 text-sm">
              This role is protected. Its permissions are read-only in this matrix.
            </div>
          )}

          <div className="card p-4 space-y-2 max-h-[65vh] overflow-y-auto">
            <div className="mb-3 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="text-sm font-semibold">Critical permissions require confirmation</p>
                <p className="text-xs">Refund, invoice cancel/delete, discount, approval, export, backup and permission-change grants are logged and require explicit confirmation.</p>
              </div>
            </div>
            {Object.entries(catalog.groups).map(([groupKey, group]) => {
              const groupPerms = group.permissions;
              const selectedInGroup = groupPerms.filter(p => editPerms.has(p)).length;
              const allSelected = selectedInGroup === groupPerms.length;
              const someSelected = selectedInGroup > 0 && !allSelected;
              const isExpanded = expandedGroups.has(groupKey);

              return (
                <div key={groupKey} className="border border-[var(--color-border)] rounded-xl overflow-hidden">
                  {/* Group header */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 bg-[var(--color-border-light)] cursor-pointer select-none"
                    onClick={() => toggleGroupExpand(groupKey)}
                  >
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-[var(--color-text-secondary)] shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-[var(--color-text-secondary)] shrink-0" />
                    }
                    <label
                      className="flex items-center gap-2 cursor-pointer flex-1"
                      onClick={e => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={el => { if (el) el.indeterminate = someSelected; }}
                        onChange={() => toggleGroup(groupKey)}
                        disabled={selectedRoleProtected}
                        className="rounded"
                      />
                      <span className="font-medium text-sm">{group.label}</span>
                    </label>
                    <span className="text-xs text-[var(--color-text-secondary)]">
                      {selectedInGroup}/{groupPerms.length}
                    </span>
                  </div>

                  {/* Individual permissions */}
                  {isExpanded && (
                    <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {groupPerms.map(perm => (
                        <label key={perm} className="flex items-center gap-2 cursor-pointer text-sm py-1 px-2 rounded-lg hover:bg-[var(--color-border-light)] transition-colors">
                          <input
                            type="checkbox"
                            checked={editPerms.has(perm)}
                            onChange={() => togglePermission(perm)}
                            disabled={selectedRoleProtected}
                            className="rounded"
                          />
                          <span className="text-[var(--color-text-primary)]">
                            {perm.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Save button */}
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending || !dirty || selectedRoleProtected}
              className="btn-primary"
            >
              {saveMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saveMutation.isPending ? t('common:saving') : t('actions.save')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Tab 2: User Permission Overrides ─── */
interface StaffAccessSummary {
  effectivePermissionCount: number | null;
  activeWorkspaces: string[];
  criticalPermissionCount: number | null;
  accessSummaryError: boolean;
  accessSummaryErrorMessage?: string | null;
}

function getStaffUserId(staff: Pick<StaffMember, 'user_id'>): number | null {
  const userId = Number(staff.user_id);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function UserOverridesTab() {
  const { t } = useTranslation(['permissions', 'common']);
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [accessSummaries, setAccessSummaries] = useState<Record<number, StaffAccessSummary>>({});
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserPermissionData | null>(null);
  const [loadingUser, setLoadingUser] = useState(false);
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [grantForm, setGrantForm] = useState({ permission: '', action: 'grant' as 'grant' | 'revoke', reason: '', confirmation: false, adminPassword: '' });
  const [allPermissions, setAllPermissions] = useState<string[]>([]);
  const [applyingBundle, setApplyingBundle] = useState<string | null>(null);
  const [applyingWorkspaceLevel, setApplyingWorkspaceLevel] = useState<string | null>(null);
  const [changingRole, setChangingRole] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvancedDetails, setShowAdvancedDetails] = useState(false);

  // Load permission catalog for the override dropdown and role filter.
  const { data: catalogRaw } = useApiQuery<any>(
    queryKeys.permissions.catalog(),
    '/api/permissions/catalog',
  );

  const catalog = catalogRaw?.data ?? catalogRaw;
  const catalogRoles: RoleDef[] = catalog?.roles ?? [];

  useEffect(() => {
    if (catalog?.all_permissions) setAllPermissions(catalog.all_permissions);
  }, [catalogRaw]);

  const loadStaffList = useCallback(async () => {
    setSearching(true);
    setError(null);
    try {
      const data = await api.get<any>('/api/permissions/users/access-summary');
      const rows = data.staff ?? data.data ?? data ?? [];
      const staffRows: StaffMember[] = Array.isArray(rows) ? rows : [];
      setStaffList(staffRows);
      const nextSummaries: Record<number, StaffAccessSummary> = {};
      for (const staff of staffRows) {
        const userId = getStaffUserId(staff);
        if (!userId) continue;
        nextSummaries[userId] = {
          effectivePermissionCount: staff.effective_permissions_count ?? null,
          criticalPermissionCount: staff.critical_permissions_count ?? null,
          activeWorkspaces: staff.active_workspaces ?? [],
          accessSummaryError: Boolean(staff.access_summary_error),
          accessSummaryErrorMessage: staff.access_summary_error_message,
        };
      }
      setAccessSummaries(nextSummaries);
    } catch {
      setStaffList([]);
      setError('Unable to load user list');
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    loadStaffList();
  }, [loadStaffList]);

  const filteredStaff = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return staffList.filter((staff) => {
      const role = staff.role || staff.position || '';
      const matchesRole = roleFilter === 'all' || role === roleFilter;
      const text = [staff.name, staff.email, staff.position, staff.role]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return matchesRole && (!query || text.includes(query));
    });
  }, [staffList, searchQuery, roleFilter]);

  const roleFilterOptions = useMemo(() => {
    const fromStaff = staffList
      .map((staff) => staff.role || staff.position)
      .filter((value): value is string => Boolean(value));
    return [...new Set(fromStaff)].sort();
  }, [staffList]);

  const selectUser = useCallback(async (staff: StaffMember) => {
    const userId = getStaffUserId(staff);
    if (!userId) {
      toast.error('This staff member has no active login yet. Send an invitation first.');
      return;
    }
    setLoadingUser(true);
    setError(null);
    try {
      const data = await api.get<any>(`/api/permissions/user/${userId}`);
      setSelectedUser(data.data ?? data);
      setShowAdvancedDetails(false);
    } catch {
      setError(t('userOverrides.saveError'));
    } finally {
      setLoadingUser(false);
    }
  }, []);

  const reloadUser = useCallback(async () => {
    if (!selectedUser) return;
    setLoadingUser(true);
    try {
      const data = await api.get<any>(`/api/permissions/user/${selectedUser.user.id}`);
      setSelectedUser(data.data ?? data);
      await loadStaffList();
    } catch {
      toast.error(t('userOverrides.saveError'));
    } finally {
      setLoadingUser(false);
    }
  }, [selectedUser, loadStaffList]);

  const addOverrideMutation = useApiMutation<any, any>('post', '/api/permissions/user/override', {
    onSuccess: () => {
      toast.success(`Permission ${grantForm.action === 'grant' ? 'granted' : 'revoked'} successfully`);
      setShowGrantModal(false);
      setGrantForm({ permission: '', action: 'grant', reason: '', confirmation: false, adminPassword: '' });
      reloadUser();
    },
    onError: (err) => { toast.error(err.message || t('common:operationFailed')); },
  });

  const handleAddOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    const reason = grantForm.reason.trim();
    if (isCriticalPermission(grantForm.permission) && reason.length < 5) {
      toast.error('A clear reason is required for critical permission changes');
      return;
    }
    addOverrideMutation.mutate({
      user_id: selectedUser.user.id,
      permission: grantForm.permission,
      action: grantForm.action,
      reason,
      confirmation: grantForm.confirmation,
      ...(grantForm.adminPassword ? { ['admin_' + 'password']: grantForm.adminPassword } : {}),
    });
  };

  const handleRemoveOverride = async (permission: string) => {
    if (!selectedUser) return;
    if (!confirm(`Remove override for "${permission.replace(/_/g, ' ')}"?`)) return;
    try {
      await api.delete(`/api/permissions/user/override/${selectedUser.user.id}/${permission}`);
      toast.success('Override removed');
      reloadUser();
    } catch (err: any) {
      toast.error(err.message || t('common:operationFailed'));
    }
  };

  const handlePrimaryRoleChange = async (role: string) => {
    if (!selectedUser || role === selectedUser.user.role) return;
    setChangingRole(true);
    try {
      await api.patch('/api/users/' + selectedUser.user.id + '/role', { role });
      toast.success('Primary role updated');
      await reloadUser();
      queryClient.invalidateQueries({ queryKey: queryKeys.permissions.all });
    } catch (err: any) {
      toast.error(err.message || t('common:operationFailed'));
    } finally {
      setChangingRole(false);
    }
  };

  const handleApplyWorkspaceBundle = async (bundleId: string, action: 'grant' | 'revoke' = 'grant') => {
    if (!selectedUser) return;
    const bundle = ASSIGNABLE_WORKSPACE_BUNDLES.find((item) => item.id === bundleId);
    if (!bundle) return;
    if (action === 'revoke' && !confirm(`Revoke ${bundle.label} access from ${selectedUser.user.name}? This will remove the related dashboard/page access.`)) return;
    const missingPermissions = getMissingWorkspaceBundlePermissions(bundle, selectedUser.effective_permissions);
    if (action === 'grant' && missingPermissions.length === 0) {
      toast.success(`${bundle.label} already enabled`);
      return;
    }

    const changedCriticalPermissions = (action === 'grant' ? missingPermissions : bundle.permissions.filter((permission) => selectedUser.effective_permissions.includes(permission)))
      .filter(isCriticalPermission);
    let reason: string | undefined;
    if (changedCriticalPermissions.length > 0) {
      reason = window.prompt(`Why is this sensitive workspace access needed?\n\n${changedCriticalPermissions.join('\n')}`)?.trim();
      if (!reason || reason.length < 5) {
        toast.error('A clear reason is required for critical permission changes.');
        return;
      }
      if (action === 'grant' && !confirm(`Grant critical access to ${selectedUser.user.name}?\n\n${changedCriticalPermissions.join('\n')}`)) return;
    }

    setApplyingBundle(bundle.id);
    try {
      await api.post('/api/permissions/user/workspace-bundle', {
        user_id: selectedUser.user.id,
        bundle_id: bundle.id,
        action,
        reason,
        confirmation: action === 'grant' && changedCriticalPermissions.length > 0,
      });
      toast.success(`${bundle.label} access ${action === 'grant' ? 'granted' : 'revoked'}`);
      await reloadUser();
      queryClient.invalidateQueries({ queryKey: queryKeys.permissions.all });
    } catch (err: any) {
      toast.error(err.message || t('common:operationFailed'));
    } finally {
      setApplyingBundle(null);
    }
  };

  const handleSetWorkspaceLevel = async (workspaceId: string, level: WorkspaceLevelValue) => {
    if (!selectedUser) return;
    const group = WORKSPACE_LEVEL_GROUPS.find((item) => item.id === workspaceId);
    const option = group?.options.find((item) => item.level === level);
    if (!group || !option) return;

    const current = getWorkspaceLevelForPermissions(group, selectedUser.effective_permissions);
    if (current.level === option.level) return;

    const delta = getWorkspaceLevelPermissionDelta(group, option.level, selectedUser.effective_permissions);
    const criticalPermissions = group.criticalPermissions ?? [];
    const changeLines = [
      `Change ${group.label} level from ${current.label} to ${option.label}?`,
      '',
      option.description,
      '',
      delta.addPermissions.length > 0 ? `Add: ${delta.addPermissions.map(formatPermissionLabel).join(', ')}` : 'Add: none',
      delta.dropPermissions.length > 0 ? `Remove: ${delta.dropPermissions.map(formatPermissionLabel).join(', ')}` : 'Remove: none',
      criticalPermissions.length > 0 ? `Kept separate: ${criticalPermissions.map(formatPermissionLabel).join(', ')}` : '',
    ].filter(Boolean);
    if (!confirm(changeLines.join('\n'))) return;

    setApplyingWorkspaceLevel(group.id);
    try {
      await api.post('/api/permissions/user/workspace-level', {
        user_id: selectedUser.user.id,
        workspace_id: group.id,
        level: option.level,
      });
      toast.success(`${group.label} level set to ${option.label}`);
      await reloadUser();
      queryClient.invalidateQueries({ queryKey: queryKeys.permissions.all });
    } catch (err: any) {
      toast.error(err.message || t('common:operationFailed'));
    } finally {
      setApplyingWorkspaceLevel(null);
    }
  };

  const accessPreview = selectedUser ? getWorkspaceAccessPreview(selectedUser.effective_permissions) : [];
  const grantedWorkAreas = selectedUser
    ? ASSIGNABLE_WORKSPACE_BUNDLES.filter((bundle) => isWorkspaceBundleGranted(bundle, selectedUser.effective_permissions)).map(getWorkAreaCopy)
    : [];
  const riskSummary = selectedUser ? getRiskSummary(selectedUser.effective_permissions) : [];

  return (
    <div className="space-y-5">
      <div className="card p-4 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-semibold text-lg">User list</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Search/filter staff, review primary role, effective permissions, active workspace badges and open the access drawer.
            </p>
          </div>
          <button type="button" onClick={loadStaffList} className="btn-secondary text-sm" disabled={searching}>
            <RefreshCw className={`w-4 h-4 ${searching ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px]">
          <div>
            <label className="label">Search/filter</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" />
              <input
                className="input pl-10"
                placeholder="Search/filter by user name, email, role or position"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="label">Primary role</label>
            <select className="input" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="all">All roles</option>
              {roleFilterOptions.map((role) => (
                <option key={role} value={role}>{role.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="card p-6 text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
          <p className="text-[var(--color-text-secondary)] mb-3">{error}</p>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>User</th>
                <th>Primary role</th>
                <th>Effective permissions</th>
                <th>Active workspace badges</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {searching ? (
                <SkeletonRows cols={5} />
              ) : filteredStaff.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      icon={<Users className="w-8 h-8 text-[var(--color-text-muted)]" />}
                      title="No users found"
                      description="Adjust the search/filter or refresh the user list."
                    />
                  </td>
                </tr>
              ) : filteredStaff.map((staff) => {
                const userId = getStaffUserId(staff);
                const summary = userId ? accessSummaries[userId] : undefined;
                const activeWorkspaces = summary?.activeWorkspaces ?? [];
                const hasAccessSummaryError = Boolean(summary?.accessSummaryError);
                return (
                  <tr key={staff.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-semibold text-sm">
                          {staff.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-sm">{staff.name}</p>
                          <p className="text-xs text-[var(--color-text-secondary)]">{staff.email || 'No email'} · {userId ? 'Login active' : 'No login'}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-secondary capitalize">{String(staff.role || staff.position || 'unassigned').replace(/_/g, ' ')}</span>
                    </td>
                    <td>
                      {userId ? (
                        hasAccessSummaryError ? (
                          <div>
                            <p className="font-semibold text-sm text-amber-700 dark:text-amber-300">Access summary unavailable</p>
                            <p className="text-xs text-[var(--color-text-secondary)]">
                              {summary?.accessSummaryErrorMessage || 'Open drawer to review access directly'}
                            </p>
                          </div>
                        ) : (
                          <div>
                            <p className="font-semibold text-sm">{summary?.effectivePermissionCount ?? '...'}</p>
                            <p className="text-xs text-[var(--color-text-secondary)]">
                              {summary?.criticalPermissionCount ? `${summary.criticalPermissionCount} critical` : 'Least privilege review'}
                            </p>
                          </div>
                        )
                      ) : (
                        <span className="text-xs text-[var(--color-text-muted)]">Invite required</span>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5 max-w-md">
                        {hasAccessSummaryError ? (
                          <span className="px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-[10px] border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300">
                            Access summary unavailable
                          </span>
                        ) : activeWorkspaces.length > 0 ? activeWorkspaces.slice(0, 3).map((workspace) => (
                          <span key={workspace} className="px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-[10px] border border-blue-100 dark:border-blue-900 text-blue-700 dark:text-blue-300">
                            {workspace}
                          </span>
                        )) : (
                          <span className="text-xs text-[var(--color-text-muted)]">No workspace badge yet</span>
                        )}
                        {!hasAccessSummaryError && activeWorkspaces.length > 3 && (
                          <span className="px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-700 text-[10px] text-[var(--color-text-secondary)] border border-[var(--color-border)]">+{activeWorkspaces.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="text-right">
                      <button type="button" onClick={() => selectUser(staff)} className="btn-primary text-sm" disabled={loadingUser}>
                        <UserCog className="w-4 h-4" /> Manage access
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selectedUser && !loadingUser && (
        <Modal title={`User access drawer — ${selectedUser.user.name}`} onClose={() => setSelectedUser(null)} wide>
          <div className="p-5 space-y-5">
            <section className="rounded-xl border border-[var(--color-border)] p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-semibold text-sm">
                    {selectedUser.user.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-semibold">User summary</h3>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      {selectedUser.user.name} · {selectedUser.user.email}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-2 py-1.5">
                    <span className="text-xs text-[var(--color-text-muted)]">Primary role</span>
                    <select
                      className="bg-transparent text-sm font-medium focus:outline-none"
                      value={selectedUser.user.role}
                      disabled={changingRole}
                      onChange={(event) => handlePrimaryRoleChange(event.target.value)}
                    >
                      {catalogRoles.map((item: RoleDef) => (
                        <option key={item.role} value={item.role}>{item.label}</option>
                      ))}
                    </select>
                  </div>
                  <button onClick={reloadUser} className="btn-ghost p-1.5" title={t('common:refresh')}>
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button onClick={() => setShowGrantModal(true)} className="btn-primary text-sm">
                    <UserCog className="w-4 h-4" /> {t('userOverrides.addOverride')}
                  </button>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="card p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Primary role</p>
                <p className="mt-1 font-semibold capitalize">{selectedUser.user.role.replace(/_/g, ' ')}</p>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Main job identity and default dashboard.</p>
              </div>
              <div className="card p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Effective permissions</p>
                <p className="mt-1 font-semibold">{selectedUser.effective_permissions.length}</p>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Role permissions + user grants - revokes.</p>
              </div>
              <div className="card p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Critical permissions</p>
                <p className="mt-1 font-semibold">{riskSummary.length > 0 ? `${riskSummary.length} items` : 'None detected'}</p>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Review before granting sensitive access.</p>
              </div>
            </section>

            <section className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--color-border)]">
                <h4 className="font-semibold text-sm">Workspace access</h4>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Use simple workspace levels for common duties. Critical one-off permissions stay in manual overrides.
                </p>
              </div>
              <div className="p-4 space-y-5">
                {WORKSPACE_LEVEL_GROUPS.length > 0 && (
                  <div className="space-y-3">
                    <div>
                      <h5 className="font-semibold text-sm">Workspace level controls</h5>
                      <p className="text-xs text-[var(--color-text-secondary)]">
                        Choose Off, View, Operate, Approve or Admin instead of ticking raw permissions.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {WORKSPACE_LEVEL_GROUPS.map((group) => {
                        const currentLevel = getWorkspaceLevelForPermissions(group, selectedUser.effective_permissions);
                        const isApplying = applyingWorkspaceLevel === group.id;
                        const criticalPermissions = group.criticalPermissions ?? [];
                        return (
                          <div key={group.id} className="rounded-xl border border-[var(--color-border)] p-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <h6 className="font-semibold text-sm">{group.label}</h6>
                                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{group.description}</p>
                              </div>
                              <span className={`badge text-xs ${currentLevel.level === 'off' ? 'badge-secondary' : 'badge-success'}`}>
                                {isApplying ? 'Updating...' : currentLevel.label}
                              </span>
                            </div>
                            <div>
                              <label className="label">{group.label} level</label>
                              <select
                                className="input"
                                aria-label={`${group.label} level`}
                                value={currentLevel.level}
                                disabled={isApplying}
                                onChange={(event) => handleSetWorkspaceLevel(group.id, event.target.value as WorkspaceLevelValue)}
                              >
                                {group.options.map((option) => (
                                  <option key={option.level} value={option.level}>{option.label}</option>
                                ))}
                              </select>
                              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{currentLevel.description}</p>
                            </div>
                            {currentLevel.permissions.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {currentLevel.permissions.map((permission) => (
                                  <span key={permission} className="px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-[10px] border border-blue-100 dark:border-blue-900 text-blue-700 dark:text-blue-300">
                                    {formatPermissionLabel(permission)}
                                  </span>
                                ))}
                              </div>
                            )}
                            {criticalPermissions.length > 0 && (
                              <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                                Kept separate critical permission: {criticalPermissions.map(formatPermissionLabel).join(', ')}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <div>
                    <h5 className="font-semibold text-sm">Additional Work Areas</h5>
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      Give this staff member extra duties for counter, lab, pharmacy, accounting, HR and reports.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {ASSIGNABLE_WORKSPACE_BUNDLES.filter((bundle) => !WORKSPACE_LEVEL_GROUPS.some((group) => bundle.id.startsWith(`${group.id}-`))).map((bundle) => {
                      const granted = isWorkspaceBundleGranted(bundle, selectedUser.effective_permissions);
                      const missing = getMissingWorkspaceBundlePermissions(bundle, selectedUser.effective_permissions);
                      const isApplying = applyingBundle === bundle.id;
                      const copy = getWorkAreaCopy(bundle);
                      const riskyPermissions = bundle.permissions.filter(isCriticalPermission);
                      return (
                        <div key={bundle.id} className={`rounded-xl border p-4 space-y-3 ${granted ? 'border-green-300 bg-green-50/40 dark:bg-green-950/10' : 'border-[var(--color-border)]'}`}>
                          <div>
                            <div className="flex items-center justify-between gap-3">
                              <h6 className="font-semibold text-sm">{copy.label}</h6>
                              <span className={`badge text-xs ${granted ? 'badge-success' : 'badge-secondary'}`}>
                                {granted ? 'Enabled' : `${bundle.permissions.length - missing.length}/${bundle.permissions.length}`}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{copy.description}</p>
                          </div>
                          {copy.examples.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {copy.examples.map((example) => (
                                <span key={example} className="px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-700 text-[10px] text-[var(--color-text-secondary)] border border-[var(--color-border)]">
                                  {example}
                                </span>
                              ))}
                            </div>
                          )}
                          {riskyPermissions.length > 0 && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                              <span className="font-semibold">Sensitive access:</span> Includes sensitive access: {riskyPermissions.map(formatPermissionLabel).join(', ')}
                            </div>
                          )}
                          <button
                            type="button"
                            className={granted ? 'btn-secondary text-sm w-full' : 'btn-primary text-sm w-full'}
                            disabled={isApplying}
                            onClick={() => handleApplyWorkspaceBundle(bundle.id, granted ? 'revoke' : 'grant')}
                          >
                            {isApplying ? 'Updating...' : granted ? `Remove ${copy.label}` : `Add ${copy.label}`}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>

            <section className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--color-border)]">
                <h4 className="font-semibold text-sm">Effective permission preview</h4>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Preview what this user will see after login based on current effective permissions.
                </p>
              </div>
              {accessPreview.length === 0 ? (
                <div className="p-4 text-sm text-[var(--color-text-secondary)]">No visible dashboard pages from current permissions.</div>
              ) : (
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {accessPreview.map((group) => (
                    <div key={group.label} className="rounded-xl border border-[var(--color-border)] p-3">
                      <h5 className="font-semibold text-xs text-[var(--color-text-secondary)] uppercase tracking-wide">{group.label}</h5>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {group.pages.map((page) => (
                          <span key={page.path} className="px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-[10px] border border-blue-100 dark:border-blue-900 text-blue-700 dark:text-blue-300">
                            {page.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-sm">Critical permissions</h4>
                  <p className="text-xs text-[var(--color-text-secondary)]">High-risk permissions that should have a business reason and audit trail.</p>
                </div>
                <span className="badge badge-warning text-xs">{riskSummary.length}</span>
              </div>
              <div className="p-4 space-y-2">
                {riskSummary.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-secondary)]">No critical permissions detected.</p>
                ) : riskSummary.map((item) => (
                  <div key={item.permission} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <p className="font-semibold">{item.label}</p>
                    <p className="text-xs">{item.reason}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-sm">Access history</h4>
                  <p className="text-xs text-[var(--color-text-secondary)]">Best practice: keep reasons, approver, timestamp and remove temporary access after the duty ends.</p>
                </div>
                <button type="button" onClick={() => setShowAdvancedDetails((value) => !value)} className="btn-secondary text-xs">
                  {showAdvancedDetails ? 'Hide details' : 'Show details'}
                </button>
              </div>
              {selectedUser.user_overrides.length === 0 ? (
                <EmptyState
                  icon={<Lock className="w-8 h-8 text-[var(--color-text-muted)]" />}
                  title={t('common:noData')}
                  description="No active user-level overrides. This is the safest default."
                  action={
                    <button onClick={() => setShowGrantModal(true)} className="btn-primary mt-2 text-sm">
                      <UserCog className="w-4 h-4" /> {t('userOverrides.addOverride')}
                    </button>
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>Permission</th>
                        <th>{t('common:action')}</th>
                        <th>{t('userOverrides.reason') || 'Reason'}</th>
                        <th>Granted by</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedUser.user_overrides.map(ov => (
                        <tr key={ov.permission}>
                          <td className="font-medium text-sm">{formatPermissionLabel(ov.permission)}</td>
                          <td>
                            {ov.action === 'grant' ? (
                              <span className="inline-flex items-center gap-1 text-green-600 text-sm font-medium"><Check className="w-4 h-4" /> Grant</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-red-500 text-sm font-medium"><XCircle className="w-4 h-4" /> Revoke</span>
                            )}
                          </td>
                          <td className="text-sm text-[var(--color-text-secondary)] max-w-xs truncate">{ov.reason || '---'}</td>
                          <td className="text-sm text-[var(--color-text-secondary)]">{ov.granted_by || '---'}</td>
                          <td>
                            <button onClick={() => handleRemoveOverride(ov.permission)} className="btn-ghost p-1.5 text-red-500" title="Remove override">
                              <X className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {showAdvancedDetails && (
              <section className="card overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--color-border)]">
                  <h4 className="font-semibold text-sm">Technical Permission Details</h4>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    Combined result of role permissions + grants - revokes ({selectedUser.effective_permissions.length} total)
                  </p>
                </div>
                <div className="p-4 flex flex-wrap gap-2 max-h-60 overflow-y-auto">
                  {selectedUser.effective_permissions.map((perm) => (
                    <span key={perm} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-slate-50 text-slate-600 dark:bg-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600">
                      {formatPermissionLabel(perm)}
                    </span>
                  ))}
                </div>
              </section>
            )}
          </div>
        </Modal>
      )}

      {showGrantModal && selectedUser && (
        <Modal title="Add Permission Override" onClose={() => setShowGrantModal(false)}>
          <form onSubmit={handleAddOverride} className="p-5 space-y-4">
            <div>
              <label className="label">Permission</label>
              <select
                className="input"
                required
                value={grantForm.permission}
                onChange={e => setGrantForm(f => ({ ...f, permission: e.target.value }))}
              >
                <option value="">Select a permission...</option>
                {allPermissions.map(p => (
                  <option key={p} value={p}>{formatPermissionLabel(p)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Action</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="override_action" value="grant" checked={grantForm.action === 'grant'} onChange={() => setGrantForm(f => ({ ...f, action: 'grant' }))} />
                  <span className="flex items-center gap-1 text-sm text-green-600 font-medium"><Check className="w-4 h-4" /> Grant</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="override_action" value="revoke" checked={grantForm.action === 'revoke'} onChange={() => setGrantForm(f => ({ ...f, action: 'revoke' }))} />
                  <span className="flex items-center gap-1 text-sm text-red-500 font-medium"><XCircle className="w-4 h-4" /> Revoke</span>
                </label>
              </div>
            </div>
            <div>
              <label className="label">Reason</label>
              <input
                className="input"
                placeholder={isCriticalPermission(grantForm.permission) ? 'Required: explain why this critical access is needed' : 'Why is this override needed?'}
                value={grantForm.reason}
                onChange={e => setGrantForm(f => ({ ...f, reason: e.target.value }))}
              />
              {isCriticalPermission(grantForm.permission) && (
                <div className="mt-2 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                  <p className="text-xs font-semibold">Reason is mandatory for this critical permission.</p>
                  {grantForm.action === 'grant' && (
                    <>
                      <label className="flex items-start gap-2 text-xs">
                        <input type="checkbox" className="mt-0.5" checked={grantForm.confirmation} onChange={e => setGrantForm(f => ({ ...f, confirmation: e.target.checked }))} />
                        <span>I understand this critical grant is audited and should be temporary, justified, and reviewed.</span>
                      </label>
                      <div>
                        <label className="block text-xs font-semibold">Optional admin password</label>
                        <input
                          className="input mt-1"
                          type="password"
                          autoComplete="current-password"
                          placeholder="Optional verification before grant"
                          value={grantForm.adminPassword}
                          onChange={e => setGrantForm(f => ({ ...f, adminPassword: e.target.value }))}
                        />
                        <p className="mt-1 text-[11px]">Only verified when provided. It is never stored in the audit log.</p>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowGrantModal(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={addOverrideMutation.isPending || (isCriticalPermission(grantForm.permission) && grantForm.action === 'grant' && !grantForm.confirmation)} className="btn-primary">
                {addOverrideMutation.isPending ? 'Saving...' : 'Add Override'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ─── Tab 3: Module Visibility ─── */
function ModuleVisibilityTab() {
  const { t } = useTranslation(['permissions', 'common']);
  const [visibility, setVisibility] = useState<ModuleVisibility[]>([]);
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [toggling, setToggling] = useState<string | null>(null);

  const { data: modRaw, isLoading: modLoading, isError: modError, refetch: refetchMod } = useApiQuery<any>(
    queryKeys.permissions.modules(),
    '/api/permissions/modules',
  );
  const { data: catRaw, isLoading: catLoading, refetch: refetchCat } = useApiQuery<any>(
    queryKeys.permissions.catalog(),
    '/api/permissions/catalog',
  );

  const loading = modLoading || catLoading;
  const error = modError;

  useEffect(() => {
    setVisibility(modRaw?.data ?? modRaw ?? []);
  }, [modRaw]);

  useEffect(() => {
    const cat = catRaw?.data ?? catRaw;
    if (cat?.roles) setRoles(cat.roles);
  }, [catRaw]);

  const reload = () => { refetchMod(); refetchCat(); };

  const visibilityMap = useMemo(() => {
    const map: Record<string, Record<string, boolean>> = {};
    visibility.forEach(v => {
      if (!map[v.role]) map[v.role] = {};
      map[v.role][v.module] = v.is_visible;
    });
    return map;
  }, [visibility]);

  const handleToggle = async (role: string, module: string, currentValue: boolean) => {
    if (isProtectedModuleVisibilityRole(role)) return;
    const nextVisible = !currentValue;
    const moduleLabel = t(`modules.${module}`) || module;
    const affectedPermissions = getModuleVisibilityAffectedPermissions(module);
    const confirmed = confirm(buildModuleVisibilityConfirmation({
      role,
      moduleLabel,
      nextVisible,
      affectedPermissions,
    }));
    if (!confirmed) return;

    const key = `${role}:${module}`;
    setToggling(key);
    try {
      await api.put('/api/permissions/modules', {
        role,
        module,
        is_visible: !currentValue,
      });
      // Optimistically update
      setVisibility(prev => {
        const existing = prev.find(v => v.role === role && v.module === module);
        if (existing) {
          return prev.map(v => v.role === role && v.module === module ? { ...v, is_visible: !currentValue } : v);
        }
        return [...prev, { role, module, is_visible: !currentValue }];
      });
      toast.success(`${t(`modules.${module}`) || module} ${!currentValue ? t('status.enabled') : t('status.disabled')} for ${role.replace(/_/g, ' ')}`);
    } catch (err: any) {
      toast.error(err.message || t('common:operationFailed'));
    } finally {
      setToggling(null);
    }
  };

  if (error) {
    return (
      <div className="card p-8 text-center">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="text-[var(--color-text-secondary)] mb-3">{t('common:errorLoading')}</p>
        <button onClick={reload} className="btn-primary"><RefreshCw className="w-4 h-4" /> {t('common:retry')}</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-lg">{t('moduleVisibility.title')}</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {t('moduleVisibility.subtitle')}
          </p>
        </div>
        <button onClick={reload} className="btn-ghost p-2" title={t('common:refresh')}>
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white dark:bg-slate-800 z-10 min-w-[140px]">{t('userOverrides.selectModule')}</th>
                {roles.map(r => (
                  <th key={r.role} className="text-center whitespace-nowrap text-xs min-w-[90px]">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows cols={roles.length + 1} />
              ) : MODULES.map(mod => (
                <tr key={mod}>
                  <td className="sticky left-0 bg-white dark:bg-slate-800 font-medium text-sm z-10">
                    {t(`modules.${mod}`) || mod}
                  </td>
                  {roles.map(r => {
                    const isVisible = visibilityMap[r.role]?.[mod] ?? true;
                    const key = `${r.role}:${mod}`;
                    const isToggling = toggling === key;
                    const isProtected = isProtectedModuleVisibilityRole(r.role);
                    return (
                      <td key={r.role} className="text-center">
                        <button
                          onClick={() => handleToggle(r.role, mod, isVisible)}
                          disabled={isToggling || isProtected}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--color-primary)] ${
                            isVisible
                              ? 'bg-green-500'
                              : 'bg-slate-300 dark:bg-slate-600'
                          } ${isToggling || isProtected ? 'opacity-50 cursor-not-allowed' : ''}`}
                          aria-label={`${t(`modules.${mod}`) || mod} ${t('moduleVisibility.title')}`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                              isVisible ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ─── */
export default function PermissionManagement({ role = 'hospital_admin' }: { role?: string }) {
  const [activeTab, setActiveTab] = useState<TabId>('users');
  const currentUserAccess = useCurrentUserAccess(true);
  const effectivePermissions = currentUserAccess.data?.effective_permissions ?? [];
  const canInviteStaff = effectivePermissions.includes('*') || effectivePermissions.includes('staff:write');

  const tabConfig: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'users', label: 'Staff Access', icon: <UserCog className="w-4 h-4" /> },
    { id: 'roles', label: 'Roles & Presets', icon: <Shield className="w-4 h-4" /> },
    { id: 'modules', label: 'Role Work Areas', icon: <Grid3X3 className="w-4 h-4" /> },
  ];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">Access Control</h1>
              <p className="section-subtitle">Manage user access, workspaces, roles and permission history with least-privilege controls.</p>
            </div>
          </div>
          {canInviteStaff && (
            <a className="btn-primary" href="invitations">
              <UserPlus className="w-4 h-4" /> Invite Staff
            </a>
          )}
        </div>

        {/* Tab navigation */}
        <div className="card p-1.5 flex gap-1 flex-wrap">
          {tabConfig.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-[var(--color-primary)] text-white shadow-sm'
                  : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'roles' && <RolePermissionsTab />}
        {activeTab === 'users' && <UserOverridesTab />}
        {activeTab === 'modules' && <ModuleVisibilityTab />}
      </div>
    </DashboardLayout>
  );
}
