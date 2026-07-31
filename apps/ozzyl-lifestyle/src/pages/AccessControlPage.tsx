import { useEffect, useMemo, useState, type ReactNode } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Lock,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  Users,
  XCircle,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';

interface PermissionGroup {
  label: string;
  permissions: string[];
}

interface WorkspaceBundle {
  id: string;
  label: string;
  description: string;
  permissions: string[];
}

interface WorkspaceLevelOption {
  level: 'off' | 'view' | 'operate' | 'approve' | 'admin';
  label: string;
  description: string;
  permissions: string[];
}

interface WorkspaceLevelGroup {
  id: string;
  label: string;
  description: string;
  options: WorkspaceLevelOption[];
  criticalPermissions?: string[];
}

interface PermissionCatalog {
  all_permissions: string[];
  groups: Record<string, PermissionGroup>;
  critical_permissions: string[];
  workspace_bundles?: WorkspaceBundle[];
  workspace_level_groups?: WorkspaceLevelGroup[];
}

interface StaffAccessSummary {
  id: number;
  user_id?: number | null;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  position?: string | null;
  effective_permissions_count?: number | null;
  critical_permissions_count?: number | null;
  active_workspaces?: string[];
  access_summary_error?: boolean;
  pending_invitation_status?: string | null;
  pending_invitation_role?: string | null;
}

interface UserPermissionOverride {
  permission: string;
  action: 'grant' | 'revoke';
  reason?: string | null;
  granted_by?: number | string | null;
  created_at?: string | null;
}

interface UserPermissionDetail {
  user: {
    id: number | string;
    name?: string | null;
    email?: string | null;
    role: string;
  };
  role_permissions: string[];
  user_overrides: UserPermissionOverride[];
  effective_permissions: string[];
}

const DEFAULT_CATALOG: PermissionCatalog = {
  all_permissions: [],
  groups: {},
  critical_permissions: [],
  workspace_bundles: [],
  workspace_level_groups: [],
};

function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string; error?: string } | undefined;
    return data?.message || data?.error || error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong';
}

function formatPermission(permission: string): string {
  return permission
    .replace(/[._:-]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue' }) {
  const classes = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200',
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${classes}`}>{children}</span>;
}

export default function AccessControlPage({ role = 'hospital_admin' }: { role?: string }) {
  const [catalog, setCatalog] = useState<PermissionCatalog>(DEFAULT_CATALOG);
  const [staff, setStaff] = useState<StaffAccessSummary[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [detail, setDetail] = useState<UserPermissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [permissionSearch, setPermissionSearch] = useState('');
  const [selectedPermission, setSelectedPermission] = useState('');
  const [action, setAction] = useState<'grant' | 'revoke'>('grant');
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [selectedWorkspaceLevel, setSelectedWorkspaceLevel] = useState<Record<string, WorkspaceLevelOption['level']>>({});

  const criticalSet = useMemo(() => new Set(catalog.critical_permissions), [catalog.critical_permissions]);
  const effectiveSet = useMemo(() => new Set(detail?.effective_permissions ?? []), [detail?.effective_permissions]);
  const userOverrideMap = useMemo(() => {
    const map = new Map<string, UserPermissionOverride>();
    for (const override of detail?.user_overrides ?? []) map.set(override.permission, override);
    return map;
  }, [detail?.user_overrides]);

  const filteredStaff = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return staff;
    return staff.filter((person) => [person.name, person.email, person.role, person.position]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle)));
  }, [search, staff]);

  const permissionOptions = useMemo(() => {
    const needle = permissionSearch.trim().toLowerCase();
    return catalog.all_permissions
      .filter((permission) => !needle || permission.toLowerCase().includes(needle) || formatPermission(permission).toLowerCase().includes(needle))
      .slice(0, 250);
  }, [catalog.all_permissions, permissionSearch]);

  const groupedEffectivePermissions = useMemo(() => {
    const effective = detail?.effective_permissions ?? [];
    const used = new Set<string>();
    const groups = Object.entries(catalog.groups).map(([key, group]) => {
      const permissions = group.permissions.filter((permission) => effective.includes(permission));
      for (const permission of permissions) used.add(permission);
      return { key, label: group.label, permissions };
    }).filter((group) => group.permissions.length > 0);

    const other = effective.filter((permission) => !used.has(permission));
    if (other.length > 0) groups.push({ key: 'other', label: 'Other / Route-level', permissions: other });
    return groups;
  }, [catalog.groups, detail?.effective_permissions]);

  const loadCatalogAndStaff = async () => {
    setLoading(true);
    try {
      const [catalogResponse, staffResponse] = await Promise.all([
        axios.get<PermissionCatalog>('/api/permissions/catalog'),
        axios.get<{ staff: StaffAccessSummary[] }>('/api/permissions/users/access-summary'),
      ]);
      const nextCatalog = {
        ...DEFAULT_CATALOG,
        ...catalogResponse.data,
        workspace_bundles: catalogResponse.data.workspace_bundles ?? [],
        workspace_level_groups: catalogResponse.data.workspace_level_groups ?? [],
      };
      const nextStaff = staffResponse.data.staff ?? [];
      setCatalog(nextCatalog);
      setStaff(nextStaff);
      setSelectedUserId((current) => {
        if (current && nextStaff.some((person) => Number(person.user_id) === current)) return current;
        const firstUserId = nextStaff.find((person) => Number(person.user_id) > 0)?.user_id;
        return firstUserId ? Number(firstUserId) : null;
      });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const loadUserDetail = async (userId: number) => {
    setDetailLoading(true);
    try {
      const { data } = await axios.get<UserPermissionDetail>(`/api/permissions/user/${userId}`);
      setDetail(data);
      setSelectedPermission(data.effective_permissions[0] ?? catalog.all_permissions[0] ?? '');
    } catch (error) {
      setDetail(null);
      toast.error(getErrorMessage(error));
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    void loadCatalogAndStaff();
  }, []);

  useEffect(() => {
    if (selectedUserId) void loadUserDetail(selectedUserId);
  }, [selectedUserId]);

  const refreshCurrentUser = async () => {
    await loadCatalogAndStaff();
    if (selectedUserId) await loadUserDetail(selectedUserId);
  };

  const applyPermissionOverride = async () => {
    if (!selectedUserId || !selectedPermission) return;
    if (criticalSet.has(selectedPermission) && action === 'grant' && !confirmation) {
      toast.error('Critical permission grant needs confirmation.');
      return;
    }
    setSaving(true);
    try {
      await axios.post('/api/permissions/user/override', {
        user_id: selectedUserId,
        permission: selectedPermission,
        action,
        reason: reason.trim() || undefined,
        confirmation,
        admin_password: adminPassword || undefined,
      });
      toast.success(`Permission ${action}ed`);
      setReason('');
      setConfirmation(false);
      setAdminPassword('');
      await refreshCurrentUser();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const removeOverride = async (permission: string) => {
    if (!selectedUserId) return;
    setSaving(true);
    try {
      await axios.delete(`/api/permissions/user/override/${selectedUserId}/${encodeURIComponent(permission)}`);
      toast.success('Override removed');
      await refreshCurrentUser();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const applyWorkspaceBundle = async (bundle: WorkspaceBundle, bundleAction: 'grant' | 'revoke') => {
    if (!selectedUserId) return;
    setSaving(true);
    try {
      await axios.post('/api/permissions/user/workspace-bundle', {
        user_id: selectedUserId,
        bundle_id: bundle.id,
        action: bundleAction,
      });
      toast.success(`${bundle.label} ${bundleAction === 'grant' ? 'granted' : 'revoked'}`);
      await refreshCurrentUser();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const applyWorkspaceLevel = async (group: WorkspaceLevelGroup) => {
    if (!selectedUserId) return;
    const level = selectedWorkspaceLevel[group.id] ?? 'off';
    setSaving(true);
    try {
      await axios.post('/api/permissions/user/workspace-level', {
        user_id: selectedUserId,
        workspace_id: group.id,
        level,
      });
      toast.success(`${group.label} level updated`);
      await refreshCurrentUser();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const selectedStaff = staff.find((person) => Number(person.user_id) === selectedUserId);
  const selectedPermissionIsCritical = criticalSet.has(selectedPermission);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
              <ShieldCheck className="h-3.5 w-3.5" /> RBAC Control Room
            </div>
            <h1 className="page-title mt-3">Access Control</h1>
            <p className="section-subtitle mt-1 max-w-3xl">
              Staff login access, workspace bundles, critical permission overrides and effective permissions in one place.
            </p>
          </div>
          <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void refreshCurrentUser()} disabled={loading || saving}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
          <section className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Users</h2>
                <p className="text-sm text-[var(--color-text-muted)]">Pick a staff account to review or change access.</p>
              </div>
              <Badge tone="blue">{staff.length}</Badge>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input className="input pl-9" placeholder="Search staff, email, role" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <div className="max-h-[680px] space-y-2 overflow-auto pr-1">
              {loading ? (
                <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">Loading access summary…</div>
              ) : filteredStaff.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-text-muted)]">No users found.</div>
              ) : filteredStaff.map((person) => {
                const userId = Number(person.user_id);
                const isSelected = userId === selectedUserId;
                const hasLogin = Number.isInteger(userId) && userId > 0;
                return (
                  <button
                    key={`${person.id}:${person.user_id ?? 'no-user'}`}
                    type="button"
                    disabled={!hasLogin}
                    onClick={() => setSelectedUserId(userId)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${isSelected ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/30' : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-blue-300'} ${!hasLogin ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[var(--color-text-primary)]">{person.name || 'Unnamed staff'}</p>
                        <p className="truncate text-xs text-[var(--color-text-muted)]">{person.email || 'No email/login yet'}</p>
                      </div>
                      {hasLogin ? <Badge tone="green">Login</Badge> : <Badge tone="amber">Invite</Badge>}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge>{person.role || person.position || 'No role'}</Badge>
                      <Badge tone={person.critical_permissions_count ? 'red' : 'slate'}>{person.critical_permissions_count ?? 0} critical</Badge>
                      <Badge tone="blue">{person.effective_permissions_count ?? 0} perms</Badge>
                    </div>
                    {person.active_workspaces?.length ? (
                      <p className="mt-2 line-clamp-2 text-xs text-[var(--color-text-muted)]">{person.active_workspaces.join(', ')}</p>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-6">
            {!selectedUserId ? (
              <div className="card p-10 text-center">
                <Users className="mx-auto h-10 w-10 text-[var(--color-text-muted)]" />
                <h2 className="mt-4 text-lg font-semibold text-[var(--color-text-primary)]">No login user selected</h2>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">Select a staff account that already has a login, or invite staff first.</p>
              </div>
            ) : (
              <>
                <div className="card space-y-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h2 className="flex items-center gap-2 text-xl font-semibold text-[var(--color-text-primary)]">
                        <UserCog className="h-5 w-5" /> {detail?.user.name || selectedStaff?.name || 'Selected user'}
                      </h2>
                      <p className="mt-1 text-sm text-[var(--color-text-muted)]">{detail?.user.email || selectedStaff?.email} · {detail?.user.role || selectedStaff?.role}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge tone="blue">{detail?.effective_permissions.length ?? 0} effective</Badge>
                      <Badge tone="amber">{detail?.user_overrides.length ?? 0} overrides</Badge>
                      <Badge tone={detail?.effective_permissions.some((permission) => criticalSet.has(permission)) ? 'red' : 'green'}>
                        {(detail?.effective_permissions ?? []).filter((permission) => criticalSet.has(permission)).length} critical
                      </Badge>
                    </div>
                  </div>

                  {detailLoading ? (
                    <div className="rounded-xl bg-[var(--color-border-light)] p-5 text-sm text-[var(--color-text-muted)]">Loading selected user access…</div>
                  ) : null}
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="card space-y-4">
                    <div>
                      <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--color-text-primary)]">
                        <SlidersHorizontal className="h-5 w-5" /> Workspace bundles
                      </h3>
                      <p className="mt-1 text-sm text-[var(--color-text-muted)]">Use these for normal day-to-day work areas instead of raw permissions.</p>
                    </div>
                    <div className="space-y-3">
                      {(catalog.workspace_bundles ?? []).map((bundle) => {
                        const granted = bundle.permissions.every((permission) => effectiveSet.has(permission) || effectiveSet.has('*'));
                        return (
                          <div key={bundle.id} className="rounded-2xl border border-[var(--color-border)] p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold text-[var(--color-text-primary)]">{bundle.label}</p>
                                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{bundle.description}</p>
                              </div>
                              <Badge tone={granted ? 'green' : 'slate'}>{granted ? 'Granted' : 'Not full'}</Badge>
                            </div>
                            <div className="mt-3 flex gap-2">
                              <button className="btn-secondary text-xs" type="button" disabled={saving || granted} onClick={() => void applyWorkspaceBundle(bundle, 'grant')}>
                                Grant
                              </button>
                              <button className="btn-secondary text-xs" type="button" disabled={saving} onClick={() => void applyWorkspaceBundle(bundle, 'revoke')}>
                                Revoke
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="card space-y-4">
                    <div>
                      <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--color-text-primary)]">
                        <KeyRound className="h-5 w-5" /> Manual permission override
                      </h3>
                      <p className="mt-1 text-sm text-[var(--color-text-muted)]">For special cases only. Critical grants require reason and confirmation.</p>
                    </div>
                    <input className="input" placeholder="Search permission" value={permissionSearch} onChange={(event) => setPermissionSearch(event.target.value)} />
                    <select className="input" value={selectedPermission} onChange={(event) => setSelectedPermission(event.target.value)}>
                      <option value="">Select permission</option>
                      {permissionOptions.map((permission) => (
                        <option key={permission} value={permission}>{permission} — {formatPermission(permission)}</option>
                      ))}
                    </select>
                    <div className="grid grid-cols-2 gap-3">
                      <button type="button" onClick={() => setAction('grant')} className={`rounded-xl border p-3 text-sm font-semibold ${action === 'grant' ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30' : 'border-[var(--color-border)]'}`}>
                        <CheckCircle2 className="mr-2 inline h-4 w-4" /> Grant
                      </button>
                      <button type="button" onClick={() => setAction('revoke')} className={`rounded-xl border p-3 text-sm font-semibold ${action === 'revoke' ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-950/30' : 'border-[var(--color-border)]'}`}>
                        <XCircle className="mr-2 inline h-4 w-4" /> Revoke
                      </button>
                    </div>
                    {selectedPermissionIsCritical ? (
                      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4" />
                          <p>This is a critical permission. Add a clear reason and confirm before granting.</p>
                        </div>
                      </div>
                    ) : null}
                    <textarea className="input min-h-24" placeholder="Reason for access change" value={reason} onChange={(event) => setReason(event.target.value)} />
                    {selectedPermissionIsCritical && action === 'grant' ? (
                      <>
                        <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                          <input type="checkbox" checked={confirmation} onChange={(event) => setConfirmation(event.target.checked)} />
                          I confirm this critical access is required.
                        </label>
                        <input className="input" type="password" placeholder="Admin password for step-up verification" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} />
                      </>
                    ) : null}
                    <button type="button" className="btn-primary w-full" disabled={saving || !selectedPermission} onClick={() => void applyPermissionOverride()}>
                      {saving ? 'Saving…' : `Apply ${action}`}
                    </button>
                  </div>
                </div>

                {(catalog.workspace_level_groups ?? []).length > 0 ? (
                  <div className="card space-y-4">
                    <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--color-text-primary)]">
                      <Lock className="h-5 w-5" /> Workspace levels
                    </h3>
                    <div className="grid gap-4 lg:grid-cols-2">
                      {(catalog.workspace_level_groups ?? []).map((group) => (
                        <div key={group.id} className="rounded-2xl border border-[var(--color-border)] p-4">
                          <p className="font-semibold text-[var(--color-text-primary)]">{group.label}</p>
                          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{group.description}</p>
                          <select
                            className="input mt-3"
                            value={selectedWorkspaceLevel[group.id] ?? 'off'}
                            onChange={(event) => setSelectedWorkspaceLevel((current) => ({
                              ...current,
                              [group.id]: event.target.value as WorkspaceLevelOption['level'],
                            }))}
                          >
                            {group.options.map((option) => <option key={option.level} value={option.level}>{option.label} — {option.description}</option>)}
                          </select>
                          {group.criticalPermissions?.length ? (
                            <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">Critical kept separate: {group.criticalPermissions.join(', ')}</p>
                          ) : null}
                          <button type="button" className="btn-secondary mt-3 text-xs" disabled={saving} onClick={() => void applyWorkspaceLevel(group)}>
                            Apply level
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="card space-y-4">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--color-text-primary)]">
                    <Shield className="h-5 w-5" /> Effective permissions
                  </h3>
                  <div className="space-y-4">
                    {groupedEffectivePermissions.map((group) => (
                      <div key={group.key} className="rounded-2xl border border-[var(--color-border)] p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="font-semibold text-[var(--color-text-primary)]">{group.label}</p>
                          <Badge>{group.permissions.length}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {group.permissions.map((permission) => {
                            const override = userOverrideMap.get(permission);
                            return (
                              <span key={permission} className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${criticalSet.has(permission) ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-200' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>
                                {permission}
                                {override ? (
                                  <button type="button" disabled={saving} onClick={() => void removeOverride(permission)} className="font-bold text-red-600 hover:text-red-800" title="Remove override">
                                    ×
                                  </button>
                                ) : null}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    {groupedEffectivePermissions.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-text-muted)]">No effective permissions found.</div>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
}
