import { useState, useEffect, useMemo, useCallback } from 'react';
import { Users, Plus, X, Search, DollarSign, UserCheck, Edit2, Trash2, ChevronRight, Shield, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import { useFmt } from '../hooks/useFmt';
import { api } from '../lib/apiClient';
import { useAuth } from '../hooks/useAuth';
import { WORKSPACE_BUNDLES, isWorkspaceBundleGranted } from '../lib/workspaceBundles';

interface Staff {
  id: number;
  name: string;
  address: string;
  position: string;
  salary: number;
  bank_account: string;
  mobile: string;
  joining_date: string;
  status: string;
  department?: string;
  email?: string | null;
  user_id?: number | null;
  pending_invitation_id?: number | null;
  pending_invitation_status?: string | null;
  pending_invitation_expires_at?: string | null;
  pending_invitation_role?: string | null;
}

interface UserAccessData {
  user: { id: number; name: string; email: string; role: string };
  role_permissions: string[];
  user_overrides: { permission: string; action: 'grant' | 'revoke'; reason?: string | null; granted_by?: number | null; created_at?: string | null }[];
  effective_permissions: string[];
}

interface Shift {
  id: number;
  shift_name: string;
  start_time: string;
  end_time: string;
}

interface StaffForm {
  name: string;
  position: string;
  department: string;
  mobile: string;
  email: string;
  salary: string;
  bank_account: string;
  joining_date: string;
  biometric_device_id: string;
  shift_type: string;
  emergency_contact: string;
  blood_group: string;
  category: string;
  send_invite: boolean;
  invite_role: string;
}

const CATEGORY_OPTIONS = [
  { value: 'manager', label: 'Manager' },
  { value: 'operations_manager', label: 'Operations Manager' },
  { value: 'branch_manager', label: 'Branch Manager' },
  { value: 'floor_manager', label: 'Floor Manager' },
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'billing_cashier', label: 'Billing / Cashier' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'nurse', label: 'Nurse' },
  { value: 'ward_boy', label: 'Ward Boy' },
  { value: 'aya', label: 'Aya / Patient Attendant' },
  { value: 'ot_assistant', label: 'OT Assistant' },
  { value: 'lab_technician', label: 'Lab Technician' },
  { value: 'lab_assistant', label: 'Lab Assistant' },
  { value: 'radiology_technician', label: 'Radiology Technician' },
  { value: 'ultrasound_assistant', label: 'USG Assistant' },
  { value: 'pharmacist', label: 'Pharmacist' },
  { value: 'store_keeper', label: 'Store Keeper' },
  { value: 'admin_officer', label: 'Admin Officer' },
  { value: 'hr_officer', label: 'HR Officer' },
  { value: 'marketing_officer', label: 'Marketing Officer' },
  { value: 'it_support', label: 'IT Support' },
  { value: 'cleaner', label: 'Cleaner' },
  { value: 'security', label: 'Security' },
  { value: 'driver', label: 'Driver' },
  { value: 'other', label: 'Other' },
];

const BLOOD_GROUP_OPTIONS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const LOGIN_ROLE_OPTIONS = [
  { value: 'reception', label: 'Reception Desk' },
  { value: 'manager', label: 'Manager / Operations' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'director', label: 'Administration' },
  { value: 'md', label: 'MD / Managing Director' },
  { value: 'nurse', label: 'Nurse' },
  { value: 'laboratory', label: 'Laboratory' },
  { value: 'pharmacist', label: 'Pharmacist' },
  { value: 'hospital_admin', label: 'Hospital Admin' },
];

function categoryFromPosition(position?: string | null): string {
  const value = (position ?? '').toLowerCase().trim();
  if (!value) return '';
  const normalized = value.replace(/[\s/-]+/g, '_');
  const matched = CATEGORY_OPTIONS.find((opt) => opt.value === normalized || opt.label.toLowerCase() === value);
  return matched?.value || '';
}

function categoryLabel(value: string): string {
  return CATEGORY_OPTIONS.find((opt) => opt.value === value)?.label || value;
}

function defaultInviteRole(position?: string | null, pendingRole?: string | null): string {
  if (pendingRole && LOGIN_ROLE_OPTIONS.some((opt) => opt.value === pendingRole)) return pendingRole;
  const value = (position ?? '').toLowerCase();
  if (value.includes('admin')) return 'hospital_admin';
  if (value.includes('director')) return 'director';
  if (value.includes('md') || value.includes('managing director')) return 'md';
  if (value.includes('manager')) return 'manager';
  if (value.includes('account')) return 'accountant';
  if (value.includes('lab') || value.includes('technician')) return 'laboratory';
  if (value.includes('nurse')) return 'nurse';
  if (value.includes('pharmacist')) return 'pharmacist';
  return 'reception';
}

function loginStatus(member: Staff): 'active' | 'pending' | 'expired' | 'revoked' | 'accepted' | 'none' {
  if (member.user_id) return 'active';
  const status = member.pending_invitation_status;
  if (status === 'pending' || status === 'expired' || status === 'revoked' || status === 'accepted') return status;
  return 'none';
}

function loginStatusBadge(status: ReturnType<typeof loginStatus>): string {
  if (status === 'active' || status === 'accepted') return 'badge-success';
  if (status === 'pending') return 'badge-warning';
  if (status === 'expired' || status === 'revoked') return 'badge-danger';
  return 'badge-secondary';
}

const EMPTY_FORM: StaffForm = {
  name: '',
  position: '',
  department: '',
  mobile: '',
  email: '',
  salary: '',
  bank_account: '',
  joining_date: new Date().toISOString().split('T')[0],
  biometric_device_id: '',
  shift_type: '',
  emergency_contact: '',
  blood_group: '',
  category: '',
  send_invite: false,
  invite_role: 'reception',
};

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 55%)`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function StaffPage({ role = 'md' }: { role?: string }) {
  const { t } = useTranslation(['staff', 'common']);
  const { fmtCurrency, fmtDate } = useFmt();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<StaffForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof StaffForm, string>>>({});
  const [confirmDelete, setConfirmDelete] = useState<Staff | null>(null);
  const [inviteModal, setInviteModal] = useState<{
    staff: Staff; link: string; email: string;
  } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [accessData, setAccessData] = useState<UserAccessData | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessApplying, setAccessApplying] = useState<string | null>(null);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawerOpen(false);
        setConfirmDelete(null);
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const { data, isLoading: loading } = useApiQuery<{ staff: Staff[] }>(
    queryKeys.staff.list(),
    '/api/staff',
  );
  const staff = data?.staff ?? [];

  const { data: shiftsData } = useApiQuery<{ data?: Shift[] } & Shift[]>(
    queryKeys.hr.shifts(),
    '/api/hr/attendance/shifts',
  );
  const shifts: Shift[] = useMemo(
    () => (shiftsData as { data?: Shift[] })?.data || (shiftsData as Shift[]) || [],
    [shiftsData],
  );

  const isLoading = loading;
  const editingMember = useMemo(() => staff.find((member) => member.id === editingId) ?? null, [staff, editingId]);
  const currentPermissions = user?.permissions ?? [];
  const canManageSystemAccess = currentPermissions.includes('*') || currentPermissions.includes('roles:manage');

  const filtered = staff.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.position.toLowerCase().includes(search.toLowerCase()) ||
    (s.department || '').toLowerCase().includes(search.toLowerCase()) ||
    s.mobile.includes(search)
  );

  const totalStaff = staff.length;
  const activeCount = staff.filter(s => s.status === 'active').length;

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setDrawerOpen(true);
  }, []);

  const openEdit = useCallback((member: Staff) => {
    setEditingId(member.id);
    setForm({
      name: member.name,
      position: member.position,
      department: member.department || '',
      mobile: member.mobile,
      email: member.email || '',
      salary: String(member.salary || ''),
      bank_account: member.bank_account || '',
      joining_date: member.joining_date || '',
      biometric_device_id: (member as any).biometric_device_id || '',
      shift_type: (member as any).shift_type || '',
      emergency_contact: (member as any).emergency_contact || '',
      blood_group: (member as any).blood_group || '',
      category: (member as any).category || categoryFromPosition(member.position),
      send_invite: false,
      invite_role: defaultInviteRole(member.position, member.pending_invitation_role),
    });
    setErrors({});
    setDrawerOpen(true);
  }, []);

  const validate = (): boolean => {
    const e: Partial<Record<keyof StaffForm, string>> = {};
    if (!form.name.trim()) e.name = t('staff:validation.nameRequired', { defaultValue: 'Name is required' });
    if (!form.position.trim()) e.position = t('staff:validation.positionRequired', { defaultValue: 'Position is required' });
    if (!form.category.trim()) e.category = t('staff:validation.categoryRequired', { defaultValue: 'Category is required' });
    if (form.salary && isNaN(Number(form.salary))) e.salary = t('staff:validation.invalidSalary', { defaultValue: 'Invalid salary' });
    if (form.send_invite && !form.email.trim()) e.email = t('staff:validation.emailRequiredForInvite', { defaultValue: 'Email is required to send login invitation' });
    if (form.send_invite && !form.invite_role) e.invite_role = t('staff:validation.roleRequiredForInvite', { defaultValue: 'Select a login role' });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const sendStaffInvite = useCallback(async (member: Pick<Staff, 'id' | 'name' | 'email'>, inviteRole?: string) => {
    setInviting(true);
    try {
      const data = await api.post<{ invite: { inviteLink: string; email: string; role?: string } }>(
        `/api/staff/${member.id}/invite`,
        { email: member.email ?? '', role: inviteRole || undefined },
      );
      const fullLink = `${window.location.origin}${data.invite.inviteLink}`;
      setInviteModal({ staff: member as Staff, link: fullLink, email: data.invite.email });
      queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
      toast.success(t('staff:inviteCreated', { defaultValue: 'Invitation ready' }));
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send invitation';
      toast.error(message);
      return false;
    } finally {
      setInviting(false);
    }
  }, [queryClient, t]);

  const createMutation = useApiMutation<{ id?: number }, Record<string, unknown>>(
    'post',
    '/api/staff',
    {
      onSuccess: async (result) => {
        toast.success(t('staff:staffAdded'));
        const createdId = Number(result?.id ?? 0);
        if (form.send_invite && createdId > 0) {
          await sendStaffInvite({ id: createdId, name: form.name, email: form.email }, form.invite_role);
        }
        setDrawerOpen(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
      },
      onError: (err) => toast.error(err.message || t('staff:failed')),
    },
  );

  const updateMutation = useApiMutation<unknown, Record<string, unknown>>(
    'put',
    (vars) => `/api/staff/${vars.id}`,
    {
      body: ({ id: _id, ...payload }) => payload,
      onSuccess: async () => {
        toast.success(t('staff:staffUpdated', { defaultValue: 'Staff updated' }));
        if (form.send_invite && editingId) {
          await sendStaffInvite({ id: editingId, name: form.name, email: form.email }, form.invite_role);
        }
        setDrawerOpen(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
      },
      onError: (err) => toast.error(err.message || t('staff:failed')),
    },
  );

  const deleteMutation = useApiMutation<unknown, Record<string, unknown>>(
    'delete',
    (vars) => `/api/staff/${vars.id}`,
    {
      onSuccess: () => {
        toast.success(t('staff:staffDeactivated', { defaultValue: 'Staff deactivated' }));
        setConfirmDelete(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
      },
      onError: (err) => toast.error(err.message || t('staff:failed')),
    },
  );

  const handleInvite = async (member: Staff) => {
    await sendStaffInvite(member, defaultInviteRole(member.position, member.pending_invitation_role));
  };

  const handleResendInvite = async (member: Staff) => {
    if (!member.pending_invitation_id || member.pending_invitation_status !== 'pending') {
      await handleInvite(member);
      return;
    }
    setInviting(true);
    try {
      const data = await api.post<{ inviteLink: string; expiresAt: string }>(
        `/api/invitations/${member.pending_invitation_id}/resend`,
        {},
      );
      setInviteModal({
        staff: member,
        link: `${window.location.origin}${data.inviteLink}`,
        email: member.email ?? '',
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
      toast.success(t('staff:inviteResent', { defaultValue: 'Invitation resent' }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resend invitation';
      toast.error(message);
    } finally {
      setInviting(false);
    }
  };

  const copyInviteLink = async () => {
    if (!inviteModal) return;
    try {
      await navigator.clipboard.writeText(inviteModal.link);
      toast.success('Invite link copied');
    } catch {
      toast.error('Failed to copy');
    }
  };


  const loadSystemAccess = useCallback(async (userId: number) => {
    if (!canManageSystemAccess) return;
    setAccessLoading(true);
    try {
      const response = await api.get<UserAccessData | { data: UserAccessData }>(`/api/permissions/user/${userId}`);
      setAccessData(('data' in response ? response.data : response) as UserAccessData);
    } catch (err) {
      setAccessData(null);
      const message = err instanceof Error ? err.message : 'Failed to load system access';
      toast.error(message);
    } finally {
      setAccessLoading(false);
    }
  }, [canManageSystemAccess]);

  useEffect(() => {
    if (!drawerOpen || !editingMember?.user_id || !canManageSystemAccess) {
      setAccessData(null);
      setAccessLoading(false);
      return;
    }
    void loadSystemAccess(editingMember.user_id);
  }, [drawerOpen, editingMember?.user_id, canManageSystemAccess, loadSystemAccess]);

  const handleToggleWorkspaceBundle = async (bundleId: string, granted: boolean) => {
    if (!editingMember?.user_id) return;
    setAccessApplying(bundleId);
    try {
      await api.post('/api/permissions/user/workspace-bundle', {
        user_id: editingMember.user_id,
        bundle_id: bundleId,
        action: granted ? 'revoke' : 'grant',
      });
      toast.success(granted ? 'Workspace access revoked' : 'Workspace access granted');
      await loadSystemAccess(editingMember.user_id);
      queryClient.invalidateQueries({ queryKey: queryKeys.permissions.all });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update workspace access';
      toast.error(message);
    } finally {
      setAccessApplying(null);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const payload: Record<string, unknown> = {
      name: form.name,
      address: '',
      position: form.position,
      department: form.department,
      mobile: form.mobile,
      email: form.email || undefined,
      salary: form.salary ? parseFloat(form.salary) : 0,
      bankAccount: form.bank_account,
      joiningDate: form.joining_date || undefined,
      emergencyContact: form.emergency_contact || undefined,
      bloodGroup: form.blood_group || undefined,
      category: form.category || undefined,
      biometricDeviceId: form.biometric_device_id || undefined,
      shiftType: form.shift_type || undefined,
    };

    if (editingId) {
      updateMutation.mutate({ ...payload, id: editingId });
    } else {
      createMutation.mutate(payload);
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('staff:staffManagement')}</h1>
              <p className="section-subtitle">{t('staff:manageHospitalStaff')}</p>
            </div>
          </div>
          <button onClick={openCreate} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('staff:addStaff')}
          </button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <KPICard
            title={t('staff:totalStaff')}
            value={totalStaff}
            loading={isLoading}
            icon={<Users className="w-5 h-5" />}
            iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]"
            index={0}
          />
          <KPICard
            title={t('staff:activeStaff')}
            value={activeCount}
            loading={isLoading}
            icon={<UserCheck className="w-5 h-5" />}
            iconBg="bg-emerald-50 text-emerald-600"
            index={1}
          />
        </div>

        {/* Search */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              type="text"
              placeholder={t('search', { ns: 'common' })}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-9"
            />
          </div>
          <span className="text-sm text-[var(--color-text-muted)]">
            {filtered.length} {t('staff:members', { defaultValue: 'members' })}
          </span>
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-12"></th>
                  <th>{t('common:name')}</th>
                  <th>{t('staff:position')}</th>
                  <th>{t('staff:department', { defaultValue: 'Department' })}</th>
                  <th className="text-right">{t('staff:salary')}</th>
                  <th className="text-center">{t('common:status')}</th>
                  <th className="text-center">{t('staff:account', { defaultValue: 'Account' })}</th>
                  <th className="text-right w-24">{t('common:actions', { defaultValue: 'Actions' })}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      {[...Array(8)].map((_, j) => (
                        <td key={j}><div className="skeleton h-4 rounded" /></td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <EmptyState
                        icon={<Users className="w-8 h-8 text-[var(--color-text-muted)]" />}
                        title={t('staff:noStaffFound')}
                        description={t('staff:noStaffFoundDesc')}
                        action={
                          <button onClick={openCreate} className="btn-primary mt-2">
                            <Plus className="w-4 h-4" /> {t('staff:addFirstStaff')}
                          </button>
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  filtered.map(member => (
                    <tr
                      key={member.id}
                      className="group cursor-pointer hover:bg-[var(--color-bg-secondary)]"
                      onClick={() => openEdit(member)}
                    >
                      <td>
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={{ backgroundColor: avatarColor(member.name) }}
                        >
                          {initials(member.name)}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div>
                            <span className="font-medium text-[var(--color-text-primary)]">{member.name}</span>
                          </div>
                        </div>
                      </td>
                      <td className="text-sm text-[var(--color-text-secondary)]">
                        <div className="flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-indigo-400" />
                          {member.position}
                        </div>
                      </td>
                      <td className="text-sm text-[var(--color-text-muted)]">
                        {member.department || '—'}
                      </td>
                      <td className="text-right font-medium font-data text-sm">
                        {fmtCurrency(member.salary || 0)}
                      </td>
                      <td className="text-center">
                        <span className={`badge ${
                          member.status === 'active' ? 'badge-success' : 'badge-secondary'
                        }`}>
                          {member.status || 'active'}
                        </span>
                      </td>
                      <td className="text-center">
                        {(() => {
                          const status = loginStatus(member);
                          const statusLabel = status === 'active'
                            ? t('staff:activeLogin', { defaultValue: 'Active Login' })
                            : status === 'pending'
                              ? t('staff:pendingInvite', { defaultValue: 'Pending Invite' })
                              : status === 'expired'
                                ? t('staff:expiredInvite', { defaultValue: 'Expired Invite' })
                                : status === 'revoked'
                                  ? t('staff:revokedInvite', { defaultValue: 'Revoked Invite' })
                                  : t('staff:noLoginAccess', { defaultValue: 'No Access' });
                          return (
                            <div className="flex flex-col items-center gap-1">
                              <span className={`badge ${loginStatusBadge(status)}`}>{statusLabel}</span>
                              {status !== 'active' && status !== 'accepted' ? (
                                <button
                                  className="btn btn-xs btn-secondary"
                                  onClick={(e) => { e.stopPropagation(); status === 'pending' ? handleResendInvite(member) : handleInvite(member); }}
                                  disabled={inviting}
                                >
                                  <UserCheck size={12} /> {status === 'pending' ? t('staff:resend', { defaultValue: 'Resend' }) : t('staff:sendInvite', { defaultValue: 'Send Invite' })}
                                </button>
                              ) : null}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); openEdit(member); }}
                            className="p-1.5 rounded-lg hover:bg-[var(--color-border-light)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
                            title={t('common:edit', { defaultValue: 'Edit' })}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmDelete(member); }}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-[var(--color-text-muted)] hover:text-red-500"
                            title={t('staff:deactivate', { defaultValue: 'Deactivate' })}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Slide-over Drawer ── */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-40 transition-opacity"
            onClick={() => setDrawerOpen(false)}
            data-testid="drawer-backdrop"
          />
          <div
            className="fixed right-0 top-0 h-full w-full max-w-md bg-[var(--color-bg)] shadow-2xl z-50 flex flex-col"
            role="dialog"
            aria-modal="true"
            data-testid="staff-drawer"
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {editingId
                  ? t('staff:editStaff', { defaultValue: 'Edit Staff' })
                  : t('staff:addStaffMember')}
              </h2>
              <button onClick={() => setDrawerOpen(false)} className="btn-ghost p-1.5">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Form */}
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

              {editingId && (
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-[var(--color-primary)]" />
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">System Access</h3>
                        <p className="text-xs text-[var(--color-text-muted)]">Manage this staff member's login workspace bundles directly from the profile.</p>
                      </div>
                    </div>
                    {editingMember?.user_id && canManageSystemAccess && (
                      <button
                        type="button"
                        className="btn-ghost p-1.5"
                        onClick={() => loadSystemAccess(editingMember.user_id!)}
                        disabled={accessLoading}
                        title="Refresh access"
                      >
                        <RefreshCw className={`w-4 h-4 ${accessLoading ? 'animate-spin' : ''}`} />
                      </button>
                    )}
                  </div>

                  {!editingMember?.user_id ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      No active login yet. Send an invitation first, then workspace access can be managed here.
                    </div>
                  ) : !canManageSystemAccess ? (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                      You need role-management permission to edit system access. Admin can manage this from Permissions.
                    </div>
                  ) : accessLoading && !accessData ? (
                    <div className="text-sm text-[var(--color-text-muted)]">Loading access...</div>
                  ) : accessData ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="badge badge-secondary">Primary role: {accessData.user.role.replace(/_/g, ' ')}</span>
                        <span className="badge badge-secondary">Effective permissions: {accessData.effective_permissions.length}</span>
                      </div>
                      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                        {WORKSPACE_BUNDLES.map((bundle) => {
                          const granted = isWorkspaceBundleGranted(bundle, accessData.effective_permissions);
                          const busy = accessApplying === bundle.id;
                          return (
                            <div key={bundle.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="text-sm font-medium text-[var(--color-text-primary)]">{bundle.label}</p>
                                  <p className="text-xs text-[var(--color-text-muted)]">{bundle.description}</p>
                                </div>
                                <span className={`badge text-xs ${granted ? 'badge-success' : 'badge-secondary'}`}>{granted ? 'Enabled' : 'Off'}</span>
                              </div>
                              <button
                                type="button"
                                className={granted ? 'btn-secondary text-xs w-full' : 'btn-primary text-xs w-full'}
                                disabled={busy}
                                onClick={() => handleToggleWorkspaceBundle(bundle.id, granted)}
                              >
                                {busy ? 'Updating...' : granted ? `Revoke ${bundle.label}` : `Grant ${bundle.label}`}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <p className="text-sm font-semibold text-[var(--color-text-primary)]">Access change history</p>
                          <span className="text-xs text-[var(--color-text-muted)]">Latest {Math.min(accessData.user_overrides.length, 5)}</span>
                        </div>
                        {accessData.user_overrides.length === 0 ? (
                          <p className="text-xs text-[var(--color-text-muted)]">No user-specific access changes yet.</p>
                        ) : (
                          <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                            {[...accessData.user_overrides]
                              .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
                              .slice(0, 5)
                              .map((override) => (
                                <div key={`${override.permission}-${override.action}`} className="rounded-md bg-[var(--color-bg-secondary)] px-2 py-2 text-xs">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium text-[var(--color-text-primary)]">{override.permission}</span>
                                    <span className={`badge text-[10px] ${override.action === 'grant' ? 'badge-success' : 'badge-warning'}`}>{override.action}</span>
                                  </div>
                                  <p className="text-[var(--color-text-muted)] mt-1">{override.reason || 'No reason recorded'}</p>
                                  {override.created_at && <p className="text-[var(--color-text-muted)] mt-0.5">{fmtDate(override.created_at)}</p>}
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-[var(--color-text-muted)]">Access details are unavailable.</div>
                  )}
                </div>
              )}

              {/* Name */}
              <div>
                <label className="label">{t('staff:nameLabel')} *</label>
                <input
                  className={`input ${errors.name ? 'border-red-400 focus:ring-red-400' : ''}`}
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={t('staff:fullNameStaff')}
                  autoFocus
                />
                {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
              </div>

              {/* Position */}
              <div>
                <label className="label">{t('staff:positionLabel')} *</label>
                <input
                  className={`input ${errors.position ? 'border-red-400 focus:ring-red-400' : ''}`}
                  value={form.position}
                  onChange={e => setForm(f => ({ ...f, position: e.target.value }))}
                  placeholder={t('staff:positionPlaceholder')}
                />
                {errors.position && <p className="text-xs text-red-500 mt-1">{errors.position}</p>}
              </div>

              {/* Department */}
              <div>
                <label className="label">{t('staff:department', { defaultValue: 'Department' })}</label>
                <input
                  className="input"
                  value={form.department}
                  onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                  placeholder={t('staff:departmentPlaceholder', { defaultValue: 'e.g. Cardiology, Admin' })}
                />
              </div>

              {/* Category */}
              <div>
                <label className="label">{t('staff:category', { defaultValue: 'Category' })} *</label>
                <select
                  className={`input ${errors.category ? 'border-red-400 focus:ring-red-400' : ''}`}
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value, position: categoryLabel(e.target.value) }))}
                >
                  <option value="">{t('staff:selectCategory', { defaultValue: 'Select category...' })}</option>
                  {CATEGORY_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                {errors.category && <p className="text-xs text-red-500 mt-1">{errors.category}</p>}
              </div>

              {/* Mobile & Salary */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('staff:mobileLabel')}</label>
                  <input
                    className="input"
                    value={form.mobile}
                    onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))}
                    placeholder={t('staff:mobilePlaceholder')}
                  />
                </div>
                <div>
                  <label className="label">{t('staff:salaryLabel')}</label>
                  <input
                    className={`input ${errors.salary ? 'border-red-400 focus:ring-red-400' : ''}`}
                    type="number"
                    value={form.salary}
                    onChange={e => setForm(f => ({ ...f, salary: e.target.value }))}
                    placeholder="0"
                  />
                  {errors.salary && <p className="text-xs text-red-500 mt-1">{errors.salary}</p>}
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="label">{t('staff:emailLabel', { defaultValue: 'Email' })}</label>
                <input
                  className={`input ${errors.email ? 'border-red-400 focus:ring-red-400' : ''}`}
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="staff@example.com"
                />
                {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
              </div>

              {/* Emergency Contact & Blood Group */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('staff:emergencyContact', { defaultValue: 'Emergency Contact' })}</label>
                  <input
                    className="input"
                    value={form.emergency_contact}
                    onChange={e => setForm(f => ({ ...f, emergency_contact: e.target.value }))}
                    placeholder={t('staff:emergencyContactPlaceholder', { defaultValue: 'Phone number' })}
                  />
                </div>
                <div>
                  <label className="label">{t('staff:bloodGroup', { defaultValue: 'Blood Group' })}</label>
                  <select
                    className="input"
                    value={form.blood_group}
                    onChange={e => setForm(f => ({ ...f, blood_group: e.target.value }))}
                  >
                    <option value="">{t('staff:selectBloodGroup', { defaultValue: 'Select...' })}</option>
                    {BLOOD_GROUP_OPTIONS.map(bg => (
                      <option key={bg} value={bg}>{bg}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Bank Account */}
              <div>
                <label className="label">{t('staff:bankAccountLabel')} <span className="text-xs text-[var(--color-text-muted)]">({t('common:optional', { defaultValue: 'Optional' })})</span></label>
                <input
                  className="input"
                  value={form.bank_account}
                  onChange={e => setForm(f => ({ ...f, bank_account: e.target.value }))}
                  placeholder={t('staff:bankAccountLaterPlaceholder', { defaultValue: 'Can be added later for payroll' })}
                />
              </div>

              {/* Software Access */}
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={form.send_invite}
                    onChange={e => setForm(f => ({ ...f, send_invite: e.target.checked }))}
                  />
                  <span>
                    <span className="block text-sm font-semibold text-[var(--color-text-primary)]">{t('staff:giveSoftwareAccess', { defaultValue: 'Give software access / send invitation' })}</span>
                    <span className="block text-xs text-[var(--color-text-muted)]">{t('staff:giveSoftwareAccessHint', { defaultValue: 'Create staff first, then send login invitation from this same form. Detailed permissions can be adjusted later from Roles & Permissions.' })}</span>
                  </span>
                </label>
                {form.send_invite ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">{t('staff:loginRole', { defaultValue: 'Login role' })} *</label>
                      <select
                        className={`input ${errors.invite_role ? 'border-red-400 focus:ring-red-400' : ''}`}
                        value={form.invite_role}
                        onChange={e => setForm(f => ({ ...f, invite_role: e.target.value }))}
                      >
                        {LOGIN_ROLE_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      {errors.invite_role && <p className="text-xs text-red-500 mt-1">{errors.invite_role}</p>}
                    </div>
                    <div className="rounded-lg bg-white/60 dark:bg-slate-900/40 p-3 text-xs text-[var(--color-text-muted)]">
                      {t('staff:advancedPermissionsHint', { defaultValue: 'For dual-purpose users, assign quick role here and fine-tune bundles in Roles & Permissions after login is accepted.' })}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Joining Date */}
              <div>
                <label className="label">{t('staff:joiningDateLabel')}</label>
                <input
                  className="input"
                  type="date"
                  value={form.joining_date}
                  onChange={e => setForm(f => ({ ...f, joining_date: e.target.value }))}
                />
              </div>

              {/* Biometric Device ID */}
              <div>
                <label className="label">{t('staff:biometricDeviceId', { defaultValue: 'Biometric Device ID' })}</label>
                <input
                  className="input"
                  value={form.biometric_device_id}
                  onChange={e => setForm(f => ({ ...f, biometric_device_id: e.target.value }))}
                  placeholder={t('staff:biometricDeviceIdPlaceholder', { defaultValue: 'For ADMS sync' })}
                />
              </div>

              {/* Shift Type */}
              <div>
                <label className="label">{t('staff:shiftType', { defaultValue: 'Shift Type' })}</label>
                <select
                  className="input"
                  value={form.shift_type}
                  onChange={e => setForm(f => ({ ...f, shift_type: e.target.value }))}
                >
                  <option value="">{t('staff:selectShift', { defaultValue: 'Select shift...' })}</option>
                  {shifts.map(sh => (
                    <option key={sh.id} value={sh.id}>
                      {sh.shift_name} ({sh.start_time}–{sh.end_time})
                    </option>
                  ))}
                </select>
              </div>
            </form>

            {/* Drawer Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)]">
              <button type="button" onClick={() => setDrawerOpen(false)} className="btn-secondary">
                {t('common:cancel')}
              </button>
              <button
                type="submit"
                onClick={handleSave}
                disabled={saving}
                className="btn-primary"
              >
                {saving
                  ? t('common:saving', { defaultValue: 'Saving...' })
                  : editingId
                    ? t('common:save', { defaultValue: 'Save' })
                    : t('staff:addStaffBtn')}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Confirm Delete Dialog ── */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[60] backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-sm p-6 text-center space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-red-100 flex items-center justify-center">
              <Trash2 className="w-6 h-6 text-red-500" />
            </div>
            <h3 className="font-semibold text-[var(--color-text-primary)]">
              {t('staff:confirmDeactivate', { defaultValue: 'Deactivate this staff member?' })}
            </h3>
            <p className="text-sm text-[var(--color-text-muted)]">
              {confirmDelete.name}
            </p>
            <div className="flex gap-3 justify-center pt-2">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary">
                {t('common:cancel')}
              </button>
              <button
                onClick={() => deleteMutation.mutate({ id: confirmDelete.id })}
                disabled={deleteMutation.isPending}
                className="btn-primary bg-red-500 hover:bg-red-600"
              >
                {deleteMutation.isPending
                  ? t('common:deactivating', { defaultValue: 'Deactivating...' })
                  : t('staff:deactivate', { defaultValue: 'Deactivate' })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Invite Modal ── */}
      {inviteModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[70] backdrop-blur-sm"
          onClick={() => setInviteModal(null)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
              {t('staff:inviteTitle', { defaultValue: 'Invitation sent' })}
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)]">
              {t('staff:inviteSentTo', { defaultValue: 'An invitation has been sent to' })}{' '}
              <strong>{inviteModal.email}</strong>
            </p>
            <p className="text-sm text-[var(--color-text-muted)]">
              {t('staff:inviteShareHint', { defaultValue: 'Share this link with the staff member to accept:' })}
            </p>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              <p>The recipient must open this link and create their own password.</p>
              <p className="mt-1 font-semibold">Do not open or complete the invitation yourself.</p>
            </div>
            <div className="flex gap-2 items-center">
              <input className="input flex-1" readOnly value={inviteModal.link} />
              <button className="btn btn-secondary" onClick={copyInviteLink}>
                {t('staff:copy', { defaultValue: 'Copy' })}
              </button>
            </div>
            <div className="flex justify-end pt-2">
              <button className="btn btn-primary" onClick={() => setInviteModal(null)}>
                {t('staff:done', { defaultValue: 'Done' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
