import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KeyRound,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  ShieldOff,
  Stethoscope,
  UserCog,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/Toast';
import EmptyState from '../components/EmptyState';
import type { PlatformRole, PlatformStaffAccount, PlatformTenantGrant, TenantRole } from '../types';
import { storeTenantImpersonationSession } from './HospitalDetail';

const PLATFORM_ROLE_OPTIONS: Array<{ value: PlatformRole; label: string; help: string }> = [
  { value: 'platform_admin', label: 'Platform Admin', help: 'Can manage staff and tenant grants except other platform admins.' },
  { value: 'platform_setup', label: 'Setup Staff', help: 'Hospital setup and scoped support access.' },
  { value: 'platform_support', label: 'Support Staff', help: 'Support access only after a hospital grant.' },
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

function canManageStaff(role?: string) {
  return role === 'super_admin' || role === 'platform_admin';
}

function canUseSupportAccess(role?: string) {
  return role === 'platform_setup' || role === 'platform_support';
}

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
      active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600'
    }`}>
      {active ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof UserCog }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary-50 p-2.5">
          <Icon className="h-5 w-5 text-primary-600" />
        </div>
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

export default function PlatformStaff() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const allowed = canManageStaff(user?.role);
  const supportAccess = canUseSupportAccess(user?.role);

  const [search, setSearch] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  const [createForm, setCreateForm] = useState({ email: '', name: '', password: '', role: 'platform_support' as PlatformRole });
  const [editForm, setEditForm] = useState({ name: '', role: 'platform_support' as PlatformRole, is_active: 1 });
  const [resetPassword, setResetPassword] = useState('');
  const [grantForm, setGrantForm] = useState({
    tenantId: '',
    allowedRole: 'reception' as TenantRole,
    reason: '',
    expiresAt: '',
  });

  const staffQuery = useQuery({
    queryKey: ['platform-staff'],
    queryFn: () => api.platformStaff.list(),
    enabled: allowed,
  });

  const hospitalsQuery = useQuery({
    queryKey: ['platform-staff-hospitals'],
    queryFn: () => api.platformStaff.hospitals(),
    enabled: allowed,
  });

  const selectedStaff = staffQuery.data?.staff.find((staff) => staff.id === selectedStaffId) || null;

  const grantsQuery = useQuery({
    queryKey: ['platform-staff-grants', selectedStaffId],
    queryFn: () => api.platformStaff.grants(selectedStaffId as number),
    enabled: allowed && Boolean(selectedStaffId),
  });

  const myGrantsQuery = useQuery({
    queryKey: ['platform-staff-my-grants'],
    queryFn: () => api.platformStaff.myGrants(),
    enabled: supportAccess,
  });

  useEffect(() => {
    if (!selectedStaffId && staffQuery.data?.staff?.[0]) {
      setSelectedStaffId(staffQuery.data.staff[0].id);
    }
  }, [selectedStaffId, staffQuery.data?.staff]);

  useEffect(() => {
    if (selectedStaff) {
      setEditForm({ name: selectedStaff.name, role: selectedStaff.role, is_active: selectedStaff.is_active });
    }
  }, [selectedStaff]);

  const filteredStaff = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = staffQuery.data?.staff || [];
    if (!term) return rows;
    return rows.filter((staff) =>
      staff.name.toLowerCase().includes(term)
      || staff.email.toLowerCase().includes(term)
      || staff.role.toLowerCase().includes(term),
    );
  }, [search, staffQuery.data?.staff]);

  const activeStaffCount = staffQuery.data?.staff.filter((staff) => staff.is_active === 1).length || 0;
  const activeGrantCount = grantsQuery.data?.grants.filter(isGrantActive).length || 0;

  const createMutation = useMutation({
    mutationFn: () => api.platformStaff.create(createForm),
    onSuccess: () => {
      toast('success', 'Platform staff account created');
      setCreateForm({ email: '', name: '', password: '', role: 'platform_support' });
      queryClient.invalidateQueries({ queryKey: ['platform-staff'] });
    },
    onError: (err: Error) => toast('error', err.message || 'Failed to create staff'),
  });

  const updateMutation = useMutation({
    mutationFn: () => api.platformStaff.update(selectedStaffId as number, editForm),
    onSuccess: () => {
      toast('success', 'Staff account updated');
      queryClient.invalidateQueries({ queryKey: ['platform-staff'] });
    },
    onError: (err: Error) => toast('error', err.message || 'Failed to update staff'),
  });

  const resetMutation = useMutation({
    mutationFn: () => api.platformStaff.resetPassword(selectedStaffId as number, resetPassword),
    onSuccess: () => {
      toast('success', 'Password reset');
      setResetPassword('');
    },
    onError: (err: Error) => toast('error', err.message || 'Failed to reset password'),
  });

  const grantMutation = useMutation({
    mutationFn: () => api.platformStaff.grant(selectedStaffId as number, {
      tenantId: Number(grantForm.tenantId),
      allowedRole: grantForm.allowedRole,
      reason: grantForm.reason,
      expiresAt: toSqlDateTime(grantForm.expiresAt),
    }),
    onSuccess: () => {
      toast('success', 'Hospital support grant added');
      setGrantForm({ tenantId: '', allowedRole: 'reception', reason: '', expiresAt: '' });
      queryClient.invalidateQueries({ queryKey: ['platform-staff-grants', selectedStaffId] });
    },
    onError: (err: Error) => toast('error', err.message || 'Failed to add grant'),
  });

  const revokeMutation = useMutation({
    mutationFn: (grantId: number) => api.platformStaff.revokeGrant(selectedStaffId as number, grantId),
    onSuccess: () => {
      toast('success', 'Grant revoked');
      queryClient.invalidateQueries({ queryKey: ['platform-staff-grants', selectedStaffId] });
    },
    onError: (err: Error) => toast('error', err.message || 'Failed to revoke grant'),
  });

  const impersonateMutation = useMutation({
    mutationFn: (grant: PlatformTenantGrant) => api.platformStaff.impersonate(grant.tenant_id, {
      reason: `Platform staff grant ${grant.id}: ${grant.reason}`,
    }),
    onSuccess: (res) => {
      storeTenantImpersonationSession({ token: res.token, tenantName: res.tenant.name, tenantId: res.tenant.id });
      toast('success', `Opening ${res.tenant.name} as ${res.targetUser.role}`);
      window.open(res.redirectUrl, '_blank');
    },
    onError: (err: Error) => toast('error', err.message || 'Failed to start support session'),
  });

  if (!allowed && supportAccess) {
    const myGrants = myGrantsQuery.data?.grants || [];
    const activeMyGrants = myGrants.filter(isGrantActive).length;

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">My Hospital Support Access</h2>
          <p className="mt-1 text-sm text-slate-500">
            Open only the hospitals and roles assigned to your support account. Ask a platform admin for additional access.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <StatCard label="Assigned grants" value={myGrants.length} icon={Stethoscope} />
          <StatCard label="Active grants" value={activeMyGrants} icon={ShieldCheck} />
        </div>

        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 p-5">
            <h3 className="font-semibold text-slate-900">Assigned hospitals</h3>
            <p className="mt-1 text-sm text-slate-500">Use Open to start a temporary support session for the granted role.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Hospital</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Reason</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Expires</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {myGrantsQuery.isLoading ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary-600" />
                    </td>
                  </tr>
                ) : myGrants.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-0">
                      <EmptyState icon={Stethoscope} title="No hospital access assigned" description="A platform admin can assign hospital support access when you need to help a client." />
                    </td>
                  </tr>
                ) : myGrants.map((grant) => {
                  const active = isGrantActive(grant);
                  return (
                    <tr key={grant.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{grant.tenant_name || `Hospital #${grant.tenant_id}`}</p>
                        <p className="text-sm text-slate-500">{grant.tenant_subdomain || '-'}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">{tenantRoleLabel[grant.allowed_role] || grant.allowed_role}</td>
                      <td className="max-w-md px-4 py-3 text-sm text-slate-600">{grant.reason}</td>
                      <td className="px-4 py-3 text-sm text-slate-500">{formatDate(grant.expires_at)}</td>
                      <td className="px-4 py-3"><StatusPill active={active} /></td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => impersonateMutation.mutate(grant)}
                          disabled={!active || impersonateMutation.isPending}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                        >
                          {impersonateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
                          Open
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
        <div className="flex items-start gap-3">
          <ShieldOff className="mt-1 h-5 w-5 text-amber-600" />
          <div>
            <h2 className="text-lg font-semibold text-amber-900">Platform staff management is restricted</h2>
            <p className="mt-1 text-sm text-amber-800">
              Only super admins and platform admins can create staff accounts, reset credentials, and grant hospital support access.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Platform Staff Access</h2>
          <p className="mt-1 text-sm text-slate-500">
            Create internal support/setup accounts and grant scoped hospital access without sharing super-admin credentials.
          </p>
        </div>
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search staff..."
            className="w-full rounded-lg border border-slate-300 py-2 pl-10 pr-4 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Total staff" value={staffQuery.data?.staff.length || 0} icon={UserCog} />
        <StatCard label="Active accounts" value={activeStaffCount} icon={ShieldCheck} />
        <StatCard label="Selected active grants" value={activeGrantCount} icon={Stethoscope} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 p-5">
            <h3 className="font-semibold text-slate-900">Staff accounts</h3>
            <p className="mt-1 text-sm text-slate-500">Select an account to edit role, status, password, and hospital grants.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Staff</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Last login</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {staffQuery.isLoading ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary-600" />
                    </td>
                  </tr>
                ) : filteredStaff.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-0">
                      <EmptyState icon={UserCog} title="No platform staff found" description="Create a staff account to start assigning support grants." />
                    </td>
                  </tr>
                ) : filteredStaff.map((staff) => (
                  <tr
                    key={staff.id}
                    onClick={() => setSelectedStaffId(staff.id)}
                    className={`cursor-pointer transition-colors hover:bg-slate-50 ${selectedStaffId === staff.id ? 'bg-primary-50/60' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-100 text-sm font-bold text-primary-700">
                          {staff.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">{staff.name}</p>
                          <p className="text-sm text-slate-500">{staff.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">{roleLabel[staff.role]}</td>
                    <td className="px-4 py-3"><StatusPill active={staff.is_active === 1} /></td>
                    <td className="px-4 py-3 text-sm text-slate-500">{formatDate(staff.last_login_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary-600" />
              <h3 className="font-semibold text-slate-900">Create staff</h3>
            </div>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                createMutation.mutate();
              }}
            >
              <input
                value={createForm.name}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Full name"
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
              />
              <input
                value={createForm.email}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, email: event.target.value }))}
                type="email"
                placeholder="email@example.com"
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
              />
              <input
                value={createForm.password}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, password: event.target.value }))}
                type="password"
                autoComplete="new-password"
                placeholder="Temporary password"
                required
                minLength={8}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
              />
              <select
                value={createForm.role}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, role: event.target.value as PlatformRole }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
              >
                {PLATFORM_ROLE_OPTIONS.map((role) => (
                  <option key={role.value} value={role.value}>{role.label}</option>
                ))}
              </select>
              <button
                disabled={createMutation.isPending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Create account
              </button>
            </form>
          </section>

          {selectedStaff && (
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-900">Selected account</h3>
                  <p className="text-sm text-slate-500">{selectedStaff.email}</p>
                </div>
                <StatusPill active={selectedStaff.is_active === 1} />
              </div>
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  updateMutation.mutate();
                }}
              >
                <input
                  value={editForm.name}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
                />
                <select
                  value={editForm.role}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, role: event.target.value as PlatformRole }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
                >
                  {PLATFORM_ROLE_OPTIONS.map((role) => (
                    <option key={role.value} value={role.value}>{role.label}</option>
                  ))}
                </select>
                <select
                  value={editForm.is_active}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, is_active: Number(event.target.value) }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
                >
                  <option value={1}>Active</option>
                  <option value={0}>Inactive</option>
                </select>
                <button
                  disabled={updateMutation.isPending}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save changes
                </button>
              </form>

              <div className="mt-5 border-t border-slate-100 pt-4">
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Reset password</label>
                <div className="flex gap-2">
                  <input
                    value={resetPassword}
                    onChange={(event) => setResetPassword(event.target.value)}
                    type="password"
                    minLength={8}
                    placeholder="New temporary password"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
                  />
                  <button
                    onClick={() => resetMutation.mutate()}
                    disabled={resetMutation.isPending || resetPassword.length < 8}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <KeyRound className="h-4 w-4" />
                    Reset
                  </button>
                </div>
              </div>
            </section>
          )}
        </aside>
      </div>

      {selectedStaff && (
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 p-5">
            <h3 className="font-semibold text-slate-900">Hospital support grants for {selectedStaff.name}</h3>
            <p className="mt-1 text-sm text-slate-500">Grant only the hospital and role needed for setup/support. Revoke access after work is complete.</p>
          </div>

          <form
            className="grid gap-3 border-b border-slate-100 p-5 lg:grid-cols-[1.2fr_1fr_1fr_1.5fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              grantMutation.mutate();
            }}
          >
            <select
              value={grantForm.tenantId}
              onChange={(event) => setGrantForm((prev) => ({ ...prev, tenantId: event.target.value }))}
              required
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Select hospital</option>
              {hospitalsQuery.data?.hospitals.map((hospital) => (
                <option key={hospital.id} value={hospital.id}>{hospital.name} ({hospital.subdomain})</option>
              ))}
            </select>
            <select
              value={grantForm.allowedRole}
              onChange={(event) => setGrantForm((prev) => ({ ...prev, allowedRole: event.target.value as TenantRole }))}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
            >
              {TENANT_ROLE_OPTIONS.map((role) => (
                <option key={role.value} value={role.value}>{role.label}</option>
              ))}
            </select>
            <input
              value={grantForm.expiresAt}
              onChange={(event) => setGrantForm((prev) => ({ ...prev, expiresAt: event.target.value }))}
              type="datetime-local"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
            />
            <input
              value={grantForm.reason}
              onChange={(event) => setGrantForm((prev) => ({ ...prev, reason: event.target.value }))}
              placeholder="Reason / ticket / setup note"
              required
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
            />
            <button
              disabled={grantMutation.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {grantMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Grant
            </button>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Hospital</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Reason</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Expires</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {grantsQuery.isLoading ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary-600" />
                    </td>
                  </tr>
                ) : grantsQuery.data?.grants.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-0">
                      <EmptyState icon={Stethoscope} title="No hospital grants yet" description="Add a scoped grant before asking staff to support a hospital." />
                    </td>
                  </tr>
                ) : grantsQuery.data?.grants.map((grant) => {
                  const active = isGrantActive(grant);
                  return (
                    <tr key={grant.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{grant.tenant_name || `Hospital #${grant.tenant_id}`}</p>
                        <p className="text-sm text-slate-500">{grant.tenant_subdomain || '-'}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">{tenantRoleLabel[grant.allowed_role] || grant.allowed_role}</td>
                      <td className="max-w-md px-4 py-3 text-sm text-slate-600">{grant.reason}</td>
                      <td className="px-4 py-3 text-sm text-slate-500">{formatDate(grant.expires_at)}</td>
                      <td className="px-4 py-3"><StatusPill active={active} /></td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => impersonateMutation.mutate(grant)}
                            disabled={!active || impersonateMutation.isPending}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                          >
                            {impersonateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
                            Open
                          </button>
                          <button
                            onClick={() => revokeMutation.mutate(grant.id)}
                            disabled={!active || revokeMutation.isPending}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            <RotateCcw className="h-4 w-4" />
                            Revoke
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
      )}
    </div>
  );
}
