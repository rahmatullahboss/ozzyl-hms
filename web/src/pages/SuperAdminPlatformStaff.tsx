import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import {
  ChevronLeft,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  Stethoscope,
  UserCog,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../lib/apiClient';
import { saveToken } from '../hooks/useAuth';
import { useAdminSession } from '../hooks/useAdminSession';

type PlatformRole = 'platform_admin' | 'platform_setup' | 'platform_support' | 'platform_auditor';
type TenantRole =
  | 'hospital_admin'
  | 'doctor'
  | 'nurse'
  | 'reception'
  | 'laboratory'
  | 'accountant'
  | 'pharmacist'
  | 'manager'
  | 'md'
  | 'director';

type PlatformStaffAccount = {
  id: number;
  email: string;
  name: string;
  role: PlatformRole;
  is_active: number;
  last_login_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type HospitalOption = {
  id: number;
  name: string;
  subdomain: string;
  status: string;
  plan: string;
};

type PlatformTenantGrant = {
  id: number;
  staff_id: number;
  tenant_id: number;
  tenant_name?: string | null;
  tenant_subdomain?: string | null;
  grant_type: 'impersonate';
  allowed_role: TenantRole;
  reason: string;
  expires_at?: string | null;
  revoked_at?: string | null;
  created_at?: string | null;
};

const PLATFORM_ROLE_OPTIONS: Array<{ value: PlatformRole; label: string; help: string }> = [
  { value: 'platform_admin', label: 'Platform Admin', help: 'Can manage platform staff except other platform admins.' },
  { value: 'platform_setup', label: 'Setup Staff', help: 'For new hospital setup and onboarding support.' },
  { value: 'platform_support', label: 'Support Staff', help: 'Can access only granted hospitals and roles.' },
  { value: 'platform_auditor', label: 'Auditor', help: 'Read-only platform review role.' },
];

const TENANT_ROLE_OPTIONS: Array<{ value: TenantRole; label: string }> = [
  { value: 'reception', label: 'Reception' },
  { value: 'manager', label: 'Manager' },
  { value: 'laboratory', label: 'Laboratory' },
  { value: 'doctor', label: 'Doctor' },
  { value: 'nurse', label: 'Nurse' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'pharmacist', label: 'Pharmacist' },
  { value: 'md', label: 'MD' },
  { value: 'director', label: 'Administration' },
  { value: 'hospital_admin', label: 'Hospital Admin' },
];

const roleLabel = Object.fromEntries(PLATFORM_ROLE_OPTIONS.map((role) => [role.value, role.label])) as Record<PlatformRole, string>;
const tenantRoleLabel = Object.fromEntries(TENANT_ROLE_OPTIONS.map((role) => [role.value, role.label])) as Record<TenantRole, string>;

function toSqlDateTime(value: string) {
  if (!value) return undefined;
  return value.includes('T') ? `${value.replace('T', ' ')}:00` : value;
}

function formatDate(value?: string | null) {
  if (!value) return 'Never';
  const parsed = new Date(value.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function isGrantActive(grant: PlatformTenantGrant) {
  if (grant.revoked_at) return false;
  if (!grant.expires_at) return true;
  return new Date(grant.expires_at.replace(' ', 'T')).getTime() > Date.now();
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
      active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
    }`}>
      {active ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof UserCog }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-[var(--color-primary-light)] p-2.5">
          <Icon className="h-5 w-5 text-[var(--color-primary)]" />
        </div>
        <div>
          <p className="text-sm text-[var(--color-text-muted)]">{label}</p>
          <p className="text-2xl font-bold text-[var(--color-text-primary)]">{value}</p>
        </div>
      </div>
    </div>
  );
}

export default function SuperAdminPlatformStaff() {
  const navigate = useNavigate();
  const { user: adminUser } = useAdminSession();
  const currentRole = adminUser?.role;
  const canManageStaff = currentRole === 'super_admin' || currentRole === 'platform_admin';
  const canUseSupportAccess = currentRole === 'platform_setup' || currentRole === 'platform_support';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [staff, setStaff] = useState<PlatformStaffAccount[]>([]);
  const [hospitals, setHospitals] = useState<HospitalOption[]>([]);
  const [grants, setGrants] = useState<PlatformTenantGrant[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', name: '', password: '', role: 'platform_support' as PlatformRole });
  const [editForm, setEditForm] = useState({ name: '', role: 'platform_support' as PlatformRole, is_active: 1 });
  const [resetPassword, setResetPassword] = useState('');
  const [grantForm, setGrantForm] = useState({
    tenantId: '',
    allowedRoles: ['reception'] as TenantRole[],
    reason: '',
    expiresAt: '',
  });

  const selectedStaff = staff.find((account) => account.id === selectedStaffId) || null;

  const filteredStaff = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return staff;
    return staff.filter((account) =>
      account.name.toLowerCase().includes(term)
      || account.email.toLowerCase().includes(term)
      || account.role.toLowerCase().includes(term),
    );
  }, [search, staff]);

  const activeStaffCount = staff.filter((account) => account.is_active === 1).length;
  const activeGrantCount = grants.filter(isGrantActive).length;

  const loadStaff = async () => {
    const data = await api.get<{ staff: PlatformStaffAccount[] }>('/api/admin/platform-staff');
    setStaff(data.staff || []);
    if (!selectedStaffId && data.staff?.[0]) setSelectedStaffId(data.staff[0].id);
  };

  const loadHospitals = async () => {
    const data = await api.get<{ hospitals: HospitalOption[] }>('/api/admin/platform-staff/hospitals');
    setHospitals(data.hospitals || []);
  };

  const loadGrants = async (staffId: number) => {
    const data = await api.get<{ grants: PlatformTenantGrant[] }>(`/api/admin/platform-staff/${staffId}/grants`);
    setGrants(data.grants || []);
  };

  const loadMyGrants = async () => {
    const data = await api.get<{ grants: PlatformTenantGrant[] }>('/api/admin/platform-staff/my-grants');
    setGrants(data.grants || []);
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      if (canManageStaff) {
        await Promise.all([loadStaff(), loadHospitals()]);
      } else if (canUseSupportAccess) {
        setStaff([]);
        setHospitals([]);
        setSelectedStaffId(null);
        await loadMyGrants();
      } else {
        setStaff([]);
        setHospitals([]);
        setGrants([]);
        setSelectedStaffId(null);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load platform staff access');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRole]);

  useEffect(() => {
    if (!canManageStaff) return;
    if (selectedStaff) {
      setEditForm({ name: selectedStaff.name, role: selectedStaff.role, is_active: selectedStaff.is_active });
      loadGrants(selectedStaff.id).catch((error) => {
        toast.error(error instanceof Error ? error.message : 'Failed to load staff grants');
      });
    } else {
      setGrants([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageStaff, selectedStaffId]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post<{ staffId: number }>('/api/admin/platform-staff', createForm);
      toast.success('Platform staff account created');
      setShowCreate(false);
      setCreateForm({ email: '', name: '', password: '', role: 'platform_support' });
      await loadStaff();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create staff');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedStaffId) return;
    setSaving(true);
    try {
      await api.put(`/api/admin/platform-staff/${selectedStaffId}`, editForm);
      toast.success('Staff account updated');
      await loadStaff();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update staff');
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedStaffId || !resetPassword) return;
    setSaving(true);
    try {
      await api.post(`/api/admin/platform-staff/${selectedStaffId}/reset-password`, { password: resetPassword });
      toast.success('Password reset. Share the new password securely.');
      setResetPassword('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reset password');
    } finally {
      setSaving(false);
    }
  };

  const toggleGrantRole = (role: TenantRole) => {
    setGrantForm((current) => {
      const exists = current.allowedRoles.includes(role);
      const allowedRoles = exists
        ? current.allowedRoles.filter((item) => item !== role)
        : [...current.allowedRoles, role];
      return { ...current, allowedRoles };
    });
  };

  const handleGrant = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedStaffId) return;
    if (!grantForm.tenantId) {
      toast.error('Select a hospital first');
      return;
    }
    if (grantForm.allowedRoles.length === 0) {
      toast.error('Select at least one hospital role');
      return;
    }

    const tenantId = Number(grantForm.tenantId);
    const activeRolesForHospital = new Set(
      grants
        .filter((grant) => grant.tenant_id === tenantId && isGrantActive(grant))
        .map((grant) => grant.allowed_role),
    );
    const rolesToGrant = grantForm.allowedRoles.filter((role) => !activeRolesForHospital.has(role));
    const skippedCount = grantForm.allowedRoles.length - rolesToGrant.length;

    if (rolesToGrant.length === 0) {
      toast.error('Selected role(s) already have active access for this hospital');
      return;
    }

    setSaving(true);
    try {
      // Keep the backend API simple and reuse the existing one-role grant endpoint,
      // but submit the selected roles as one bulk UI action.
      await Promise.all(
        rolesToGrant.map((allowedRole) => api.post(
          `/api/admin/platform-staff/${selectedStaffId}/grants`,
          {
            tenantId,
            allowedRole,
            reason: grantForm.reason,
            expiresAt: toSqlDateTime(grantForm.expiresAt),
          },
        )),
      );
      const roleWord = rolesToGrant.length > 1 ? 'roles' : 'role';
      const skippedText = skippedCount ? `, ${skippedCount} duplicate skipped` : '';
      toast.success(`${rolesToGrant.length} hospital ${roleWord} granted${skippedText}`);
      setGrantForm({ tenantId: '', allowedRoles: ['reception'], reason: '', expiresAt: '' });
      await loadGrants(selectedStaffId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add grant');
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeGrant = async (grantId: number) => {
    if (!selectedStaffId) return;
    setSaving(true);
    try {
      await api.delete(`/api/admin/platform-staff/${selectedStaffId}/grants/${grantId}`);
      toast.success('Grant revoked');
      await loadGrants(selectedStaffId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to revoke grant');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenGrant = async (grant: PlatformTenantGrant) => {
    try {
      const response = await api.post<{ token: string; redirectUrl: string; tenant: { name: string; id: number }; targetUser: { role: string } }>(
        `/api/admin/platform-staff/impersonate/${grant.tenant_id}`,
        { grantId: grant.id, reason: `Platform staff grant ${grant.id}: ${grant.reason}` },
      );
      saveToken(response.token);
      toast.success(`Opening ${response.tenant.name} as ${response.targetUser.role}`);
      navigate(response.redirectUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to open support session');
    }
  };

  if (!canManageStaff) {
    const activeSelfGrants = grants.filter(isGrantActive);
    const inactiveSelfGrants = grants.length - activeSelfGrants.length;
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/super-admin/platform-staff')} className="btn-ghost p-2" aria-label="Back">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                <Stethoscope className="w-6 h-6 text-[var(--color-primary)]" />
                My Hospital Support Access
              </h1>
              <p className="text-sm text-[var(--color-text-muted)]">
                Open only the hospitals and roles assigned to your Ozzyl support account.
              </p>
            </div>
          </div>
          <button onClick={loadAll} className="btn-ghost" title="Refresh">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <StatCard label="Assigned hospitals" value={grants.length} icon={Stethoscope} />
          <StatCard label="Active access" value={activeSelfGrants.length} icon={ShieldCheck} />
          <StatCard label="Expired/revoked" value={inactiveSelfGrants} icon={ShieldOff} />
        </div>

        {!canUseSupportAccess ? (
          <section className="card p-8 text-center">
            <ShieldOff className="w-12 h-12 mx-auto text-slate-400 mb-3" />
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">No support console access</h2>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              Your current role is {currentRole ? roleLabel[currentRole as PlatformRole] || currentRole : 'unknown'}.
              Ask a super admin to assign a support/setup role if you need hospital access.
            </p>
          </section>
        ) : (
          <section className="card overflow-hidden">
            <div className="border-b border-[var(--color-border)] p-5">
              <h2 className="font-semibold text-[var(--color-text-primary)]">Assigned Hospitals</h2>
              <p className="text-sm text-[var(--color-text-muted)]">
                These grants are controlled by the platform super admin. You cannot create or edit staff accounts.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Hospital</th>
                    <th>Role</th>
                    <th>Reason</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(3)].map((_, index) => (
                      <tr key={index}><td colSpan={6}><div className="skeleton h-5 w-full" /></td></tr>
                    ))
                  ) : grants.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-[var(--color-text-muted)]">
                        No hospital access has been assigned to your account yet.
                      </td>
                    </tr>
                  ) : grants.map((grant) => {
                    const active = isGrantActive(grant);
                    return (
                      <tr key={grant.id}>
                        <td>
                          <p className="font-medium text-[var(--color-text-primary)]">{grant.tenant_name || `Hospital #${grant.tenant_id}`}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">{grant.tenant_subdomain || '-'}</p>
                        </td>
                        <td>{tenantRoleLabel[grant.allowed_role] || grant.allowed_role}</td>
                        <td className="max-w-md text-sm text-[var(--color-text-secondary)]">{grant.reason}</td>
                        <td className="text-sm text-[var(--color-text-muted)]">{formatDate(grant.expires_at)}</td>
                        <td><StatusPill active={active} /></td>
                        <td>
                          <button onClick={() => handleOpenGrant(grant)} disabled={!active} className="btn-primary disabled:opacity-50">
                            <Stethoscope className="w-4 h-4" /> Open Hospital
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/super-admin/dashboard')} className="btn-ghost p-2" aria-label="Back to dashboard">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] flex items-center gap-2">
              <UserCog className="w-6 h-6 text-[var(--color-primary)]" />
              Platform Staff
            </h1>
            <p className="text-sm text-[var(--color-text-muted)]">
              Create Ozzyl support/setup staff accounts and grant scoped hospital access.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadAll} className="btn-ghost" title="Refresh">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> Create Staff
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <StatCard label="Total staff" value={staff.length} icon={UserCog} />
        <StatCard label="Active accounts" value={activeStaffCount} icon={ShieldCheck} />
        <StatCard label="Selected active grants" value={activeGrantCount} icon={Stethoscope} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="card overflow-hidden">
          <div className="border-b border-[var(--color-border)] p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search staff by name, email, or role..."
                className="input-field w-full pl-9"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last login</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(4)].map((_, index) => (
                    <tr key={index}>
                      <td colSpan={4}><div className="skeleton h-5 w-full" /></td>
                    </tr>
                  ))
                ) : filteredStaff.length === 0 ? (
                  <tr><td colSpan={4} className="py-10 text-center text-[var(--color-text-muted)]">No platform staff found.</td></tr>
                ) : filteredStaff.map((account) => {
                  const selected = account.id === selectedStaffId;
                  return (
                    <tr
                      key={account.id}
                      onClick={() => setSelectedStaffId(account.id)}
                      className={`cursor-pointer ${selected ? 'bg-[var(--color-primary-light)]' : ''}`}
                    >
                      <td>
                        <p className="font-semibold text-[var(--color-text-primary)]">{account.name}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">{account.email}</p>
                      </td>
                      <td><span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{roleLabel[account.role] || account.role}</span></td>
                      <td><StatusPill active={account.is_active === 1} /></td>
                      <td className="text-sm text-[var(--color-text-muted)]">{formatDate(account.last_login_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-6">
          <section className="card p-5">
            <h2 className="font-semibold text-[var(--color-text-primary)] mb-4">Selected Staff</h2>
            {selectedStaff ? (
              <form onSubmit={handleUpdate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Name</label>
                  <input className="input-field w-full" value={editForm.name} onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Platform Role</label>
                  <select className="input-field w-full" value={editForm.role} onChange={(event) => setEditForm((current) => ({ ...current, role: event.target.value as PlatformRole }))}>
                    {PLATFORM_ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                  </select>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{PLATFORM_ROLE_OPTIONS.find((role) => role.value === editForm.role)?.help}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Status</label>
                  <select className="input-field w-full" value={editForm.is_active} onChange={(event) => setEditForm((current) => ({ ...current, is_active: Number(event.target.value) }))}>
                    <option value={1}>Active</option>
                    <option value={0}>Inactive</option>
                  </select>
                </div>
                <button type="submit" disabled={saving} className="btn-primary w-full">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  Save Changes
                </button>
              </form>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">Select a staff account to edit.</p>
            )}
          </section>

          <section className="card p-5">
            <h2 className="font-semibold text-[var(--color-text-primary)] mb-4 flex items-center gap-2"><KeyRound className="w-4 h-4" /> Reset Password</h2>
            <form onSubmit={handleResetPassword} className="space-y-3">
              <input
                type="password"
                minLength={8}
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                className="input-field w-full"
                placeholder="New temporary password"
                disabled={!selectedStaff}
              />
              <button type="submit" disabled={!selectedStaff || !resetPassword || saving} className="btn-ghost w-full justify-center">
                Reset Password
              </button>
            </form>
          </section>
        </aside>
      </div>

      <section className="card p-5 mt-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-4">
          <div>
            <h2 className="font-semibold text-[var(--color-text-primary)]">Hospital Support Grants</h2>
            <p className="text-sm text-[var(--color-text-muted)]">Assign selected staff to a hospital role for setup/support.</p>
          </div>
          {selectedStaff && <p className="text-sm text-[var(--color-text-secondary)]">Selected: <span className="font-semibold">{selectedStaff.name}</span></p>}
        </div>

        <form
          onSubmit={handleGrant}
          className="grid gap-3 md:grid-cols-[minmax(220px,1.4fr)_minmax(260px,1.5fr)_minmax(220px,1fr)_auto] mb-5 overflow-visible"
        >
          <select
            required
            disabled={!selectedStaff}
            className="input-field w-full min-w-0"
            value={grantForm.tenantId}
            onChange={(event) => setGrantForm((current) => ({ ...current, tenantId: event.target.value }))}
          >
            <option value="">Select hospital</option>
            {hospitals.map((hospital) => (
              <option key={hospital.id} value={hospital.id}>
                {hospital.name} ({hospital.subdomain})
              </option>
            ))}
          </select>
          <input
            required
            disabled={!selectedStaff}
            className="input-field w-full min-w-0"
            value={grantForm.reason}
            onChange={(event) => setGrantForm((current) => ({ ...current, reason: event.target.value }))}
            placeholder="Reason: onsite setup, support ticket..."
          />
          <input
            disabled={!selectedStaff}
            className="input-field w-full min-w-0"
            type="datetime-local"
            value={grantForm.expiresAt}
            onChange={(event) => setGrantForm((current) => ({ ...current, expiresAt: event.target.value }))}
          />
          <button
            type="submit"
            disabled={!selectedStaff || saving || grantForm.allowedRoles.length === 0}
            className="btn-primary justify-center whitespace-nowrap"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Grant {grantForm.allowedRoles.length || ''} Role{grantForm.allowedRoles.length > 1 ? 's' : ''}
          </button>
          <div className="md:col-span-4 rounded-xl border border-[var(--color-border)] bg-slate-50/70 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--color-text-secondary)]">
                Select one or more hospital roles{' '}
                <span className="font-normal text-[var(--color-text-muted)]">({grantForm.allowedRoles.length} selected)</span>
              </p>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  className="text-[var(--color-primary)] hover:underline"
                  disabled={!selectedStaff}
                  onClick={() => setGrantForm((current) => ({
                    ...current,
                    allowedRoles: TENANT_ROLE_OPTIONS.map((role) => role.value),
                  }))}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-slate-500 hover:underline"
                  disabled={!selectedStaff}
                  onClick={() => setGrantForm((current) => ({
                    ...current,
                    allowedRoles: [],
                  }))}
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {TENANT_ROLE_OPTIONS.map((role) => {
                const checked = grantForm.allowedRoles.includes(role.value);
                const duplicateActive = grantForm.tenantId !== '' && grants.some(
                  (grant) => grant.tenant_id === Number(grantForm.tenantId) && grant.allowed_role === role.value && isGrantActive(grant),
                );
                const roleStateClass = checked
                  ? 'border-[var(--color-primary)] bg-white text-[var(--color-primary)] shadow-sm'
                  : 'border-slate-200 bg-white/60 text-[var(--color-text-secondary)]';
                const labelClassName = [
                  'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition',
                  roleStateClass,
                  duplicateActive ? 'opacity-60' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <label
                    key={role.value}
                    className={labelClassName}
                    title={duplicateActive ? 'Already active for this hospital; duplicate will be skipped' : undefined}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--color-primary)]"
                      checked={checked}
                      disabled={!selectedStaff}
                      onChange={() => toggleGrantRole(role.value)}
                    />
                    <span>{role.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </form>

        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Hospital</th>
                <th>Role</th>
                <th>Reason</th>
                <th>Expires</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {!selectedStaff ? (
                <tr><td colSpan={6} className="py-8 text-center text-[var(--color-text-muted)]">Select a staff account to view grants.</td></tr>
              ) : grants.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-[var(--color-text-muted)]">No hospital grants for this staff account.</td></tr>
              ) : grants.map((grant) => {
                const active = isGrantActive(grant);
                return (
                  <tr key={grant.id}>
                    <td>
                      <p className="font-medium text-[var(--color-text-primary)]">{grant.tenant_name || `Hospital #${grant.tenant_id}`}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{grant.tenant_subdomain || '-'}</p>
                    </td>
                    <td>{tenantRoleLabel[grant.allowed_role] || grant.allowed_role}</td>
                    <td className="max-w-md text-sm text-[var(--color-text-secondary)]">{grant.reason}</td>
                    <td className="text-sm text-[var(--color-text-muted)]">{formatDate(grant.expires_at)}</td>
                    <td><StatusPill active={active} /></td>
                    <td>
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleOpenGrant(grant)} disabled={!active} className="btn-ghost p-1.5 text-indigo-600" title="Open support session">
                          <Stethoscope className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleRevokeGrant(grant.id)} disabled={!active || saving} className="btn-ghost p-1.5 text-red-600" title="Revoke grant">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="card max-w-lg w-full mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Create Platform Staff</h2>
              <button onClick={() => setShowCreate(false)} className="btn-ghost p-1" aria-label="Close create staff dialog"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Name</label>
                <input required className="input-field w-full" value={createForm.name} onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))} placeholder="Staff full name" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Email</label>
                <input required type="email" className="input-field w-full" value={createForm.email} onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))} placeholder="staff@ozzyl.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Temporary Password</label>
                <input required type="password" minLength={8} className="input-field w-full" value={createForm.password} onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))} placeholder="Minimum 8 characters" />
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">Share this password securely and reset it whenever needed.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Platform Role</label>
                <select className="input-field w-full" value={createForm.role} onChange={(event) => setCreateForm((current) => ({ ...current, role: event.target.value as PlatformRole }))}>
                  {PLATFORM_ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                </select>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{PLATFORM_ROLE_OPTIONS.find((role) => role.value === createForm.role)?.help}</p>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="btn-ghost flex-1">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Create Staff
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
