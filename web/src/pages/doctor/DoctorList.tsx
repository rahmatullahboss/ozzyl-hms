import { useState, useMemo } from 'react';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Search, Plus, Filter, Globe } from 'lucide-react';
import DataTable from '../../components/dashboard/DataTable';
import { DoctorDrawer } from '../../components/doctor/DoctorDrawer';
import DashboardLayout from '../../components/DashboardLayout';
import { Doctor } from '../../components/doctor/types';

function initials(name: string) {
  return name
    .split(' ')
    .map(w => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function isDoctorActive(doctor: Doctor): boolean {
  return Number(doctor.isActive ?? doctor.is_active ?? 0) === 1;
}

export default function DoctorList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['doctor', 'common']);
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState<'active' | 'all'>('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Doctor | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ inviteLink: string; email: string | null } | null>(null);

  const { data, isLoading } = useApiQuery<{ doctors: Doctor[] }>(
    ['doctors', 'list', { search, specialty, department, is_active: status }],
    `/api/doctors?${new URLSearchParams({
      is_active: status,
      ...(search ? { search } : {}),
      ...(specialty ? { specialty } : {}),
      ...(department ? { department } : {}),
    }).toString()}`,
  );

  const doctors = data?.doctors ?? [];

  const specialties = useMemo(() => {
    const set = new Set(doctors.map(d => d.specialty).filter(Boolean) as string[]);
    return [...set].sort();
  }, [doctors]);

  const departments = useMemo(() => {
    const set = new Set(doctors.map(d => d.department).filter(Boolean) as string[]);
    return [...set].sort();
  }, [doctors]);

  const stats = useMemo(() => ({
    total: doctors.length,
    active: doctors.filter(isDoctorActive).length,
    inactive: doctors.filter(d => !isDoctorActive(d)).length,
    marketplace: doctors.filter(d => d.isMarketplaceVisible || d.is_marketplace_visible).length,
  }), [doctors]);

  const deactivate = useApiMutation<unknown, number>(
    'put',
    (id: number) => `/api/doctors/${id}/deactivate`,
    {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: queryKeys.doctors.all });
        toast.success(t('doctor.deactivated', 'Doctor deactivated'));
      },
      onError: () => toast.error(t('doctor.failed', 'Failed')),
    },
  );

  const activate = useApiMutation<unknown, number>(
    'put',
    (id: number) => `/api/doctors/${id}/activate`,
    {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: queryKeys.doctors.all });
        toast.success(t('doctor.activated', 'Doctor activated'));
      },
      onError: () => toast.error(t('doctor.failed', 'Failed')),
    },
  );

  const publish = useApiMutation<unknown, number>(
    'post',
    (id: number) => `/api/doctors/${id}/publish`,
    {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: queryKeys.doctors.all });
        toast.success(t('doctor.published', 'Doctor published to marketplace'));
      },
      onError: () => toast.error(t('doctor.publishFailed', 'Failed to publish')),
    },
  );

  const inviteDoctor = useApiMutation<
    { invite: { inviteLink: string; email: string | null; role: string; doctorId: number | null; doctorName: string | null; expiresAt: string } },
    { id: number; email?: string }
  >('post', (vars) => `/api/doctors/${vars.id}/invite`, {
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.doctors.all });
      qc.invalidateQueries({ queryKey: queryKeys.invitations.all });
      setInviteResult(data.invite);
      toast.success(t('doctor.invite_sent', 'Invitation sent'));
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t('doctor.invite_failed', 'Invite failed')),
  });

  const openEdit = (doctor: Doctor) => {
    setEditing(doctor);
    setDrawerOpen(true);
  };

  const openAdd = () => {
    setEditing(null);
    setDrawerOpen(true);
  };

  const clearFilters = () => {
    setSearch('');
    setSpecialty('');
    setDepartment('');
    setStatus('all');
  };

  const hasFilters = search || specialty || department || status !== 'all';

  const confirmDeactivate = (doctor: Doctor) => {
    const ok = window.confirm(
      t('doctor.confirmDeactivate', `Deactivate ${doctor.name}? They will be hidden from the active doctor list until reactivated.`),
    );
    if (!ok) return;
    deactivate.mutate(doctor.id);
  };

  const columns = [
    {
      key: 'name',
      header: t('doctor.name', 'Name'),
      render: (d: Doctor) => (
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-100 to-blue-100 flex items-center justify-center text-xs font-bold text-cyan-700 shrink-0">
            {initials(d.name)}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-[var(--color-text-primary)] truncate">{d.name}</p>
            <p className="text-xs text-[var(--color-text-muted)] truncate">
              {d.bmdcRegNo || d.bmdc_reg_no || '—'}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'specialty',
      header: t('doctor.specialty', 'Specialty'),
      render: (d: Doctor) => (
        <span className="text-sm">{d.specialty || '—'}</span>
      ),
    },
    {
      key: 'department',
      header: t('doctor.department', 'Department'),
      render: (d: Doctor) => (
        <span className="text-sm">{d.department || '—'}</span>
      ),
    },
    {
      key: 'consultationFee',
      header: t('doctor.fee', 'Fee'),
      className: 'w-24',
      render: (d: Doctor) => (
        <span className="font-mono text-sm">{t('common:currencySymbol', '৳')}{d.consultationFee ?? d.consultation_fee ?? 0}</span>
      ),
    },
    {
      key: 'status',
      header: t('doctor.status', 'Status'),
      className: 'w-24',
      render: (d: Doctor) => {
        const active = isDoctorActive(d);
        return (
          <span className={active ? 'badge-success' : 'badge-neutral'}>
            {active ? t('doctor.active', 'Active') : t('doctor.inactive', 'Inactive')}
          </span>
        );
      },
    },
    {
      key: 'marketplace' as keyof Doctor,
      header: t('doctor.marketplace', 'Marketplace'),
      className: 'w-28',
      render: (d: Doctor) => {
        const visible = d.isMarketplaceVisible ?? d.is_marketplace_visible;
        return (
          <span className={visible ? 'badge-info' : 'badge-neutral'}>
            {visible ? t('doctor.public', 'Public') : t('doctor.private', 'Private')}
          </span>
        );
      },
    },
    {
      key: 'invite',
      header: t('doctor.account', 'Account'),
      className: 'w-28',
      render: (d: Doctor) => {
        if (d.user_id) {
          return <span className="badge badge-success">✓ {t('doctor.linked', 'Linked')}</span>;
        }
        return (
          <button
            className="btn-ghost text-xs"
            onClick={() => inviteDoctor.mutate({ id: d.id, email: d.email?.trim() || undefined })}
            disabled={inviteDoctor.isPending}
            title={!d.email ? t('doctor.generate_link_no_email', 'Generate a link; doctor will enter email when accepting') : undefined}
          >
            ✉ {d.email ? t('doctor.invite', 'Invite') : t('doctor.generateLink', 'Generate Link')}
          </button>
        );
      },
    },
    {
      key: 'actions' as keyof Doctor,
      header: t('common:actions', 'Actions'),
      className: 'w-44',
      render: (d: Doctor) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => openEdit(d)}
            className="btn-ghost !px-2 !py-1 text-xs"
            title={t('common:edit', 'Edit')}
          >
            {t('common:edit', 'Edit')}
          </button>
          {(!d.isMarketplaceVisible && !d.is_marketplace_visible) && (
            <button
              onClick={() => publish.mutate(d.id)}
              disabled={publish.isPending}
              className="btn-ghost !px-2 !py-1 text-xs text-emerald-600"
              title={t('doctor.publish', 'Publish to marketplace')}
            >
              <Globe className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() =>
              isDoctorActive(d)
                ? confirmDeactivate(d)
                : activate.mutate(d.id)
            }
            className={`!px-2 !py-1 text-xs ${
              isDoctorActive(d) ? 'btn-ghost text-red-500' : 'btn-ghost text-green-600'
            }`}
          >
            {isDoctorActive(d)
              ? t('doctor.deactivate', 'Deactivate')
              : t('doctor.activate', 'Activate')}
          </button>
        </div>
      ),
    },
  ];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-4 max-w-screen-2xl mx-auto">
        {/* Page Header */}
        <div className="page-header">
          <div className="flex-1">
            <h1 className="page-title">{t('doctor.title', 'Doctor Management')}</h1>
            <p className="section-subtitle mt-1">
              {stats.total} {t('doctor.doctors', 'doctors')} · {stats.active} {t('doctor.active', 'active')} · {stats.marketplace} {t('doctor.onMarketplace', 'on marketplace')}
            </p>
          </div>
          <button onClick={openAdd} className="btn-primary">
            <Plus className="w-4 h-4" />
            {t('doctor.addDoctor', 'Add Doctor')}
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-[var(--color-text-primary)]">{stats.total}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{t('doctor.totalDoctors', 'Total')}</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">{stats.active}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{t('doctor.activeDoctors', 'Active')}</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-slate-500">{stats.inactive}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{t('doctor.inactiveDoctors', 'Inactive')}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="card p-3 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('doctor.searchPlaceholder', 'Search name, mobile, BMDC...')}
                className="input pl-9"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`btn-secondary ${showFilters ? 'bg-[var(--color-border-light)]' : ''}`}
            >
              <Filter className="w-4 h-4" />
              {t('common:filters', 'Filters')}
            </button>
            {hasFilters && (
              <button onClick={clearFilters} className="btn-ghost text-xs">
                {t('common:clear', 'Clear')}
              </button>
            )}
          </div>

          {showFilters && (
            <div className="flex gap-3 flex-wrap pt-1 border-t border-[var(--color-border)]">
              <select
                value={specialty}
                onChange={e => setSpecialty(e.target.value)}
                className="input w-48"
              >
                <option value="">{t('doctor.allSpecialties', 'All Specialties')}</option>
                {specialties.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select
                value={department}
                onChange={e => setDepartment(e.target.value)}
                className="input w-48"
              >
                <option value="">{t('doctor.allDepartments', 'All Departments')}</option>
                {departments.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as 'active' | 'all')}
                className="input w-40"
              >
                <option value="all">{t('doctor.allDoctors', 'All Doctors')}</option>
                <option value="active">{t('doctor.activeOnly', 'Active Only')}</option>
              </select>
            </div>
          )}
        </div>

        {/* Data Table */}
        <DataTable
          data={doctors}
          columns={columns}
          keyField="id"
          loading={isLoading}
          emptyMessage={t('doctor.noDoctors', 'No doctors found')}
        />

        {/* Add/Edit Drawer */}
        <DoctorDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          doctor={editing}
          onSuccess={() => {
            setDrawerOpen(false);
            qc.invalidateQueries({ queryKey: queryKeys.doctors.all });
          }}
        />

        {/* Invite result modal */}
        {inviteResult && (
          <div className="modal-overlay" onClick={() => setInviteResult(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>{t('doctor.invitation_created', 'Invitation Created')}</h3>
                <button className="modal-close" onClick={() => setInviteResult(null)}>✕</button>
              </div>
              <p>
                {inviteResult.email
                  ? <>{t('doctor.share_link_with', 'Share this link with')} <code>{inviteResult.email}</code>:</>
                  : t('doctor.share_link_directly', 'Share this link directly with the doctor. They will enter email and password while accepting:')}
              </p>
              <div className="link-box">
                <code>{`${window.location.origin}${inviteResult.inviteLink}`}</code>
                <button
                  className="btn-copy"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}${inviteResult.inviteLink}`);
                    toast.success(t('doctor.copied', 'Copied!'));
                  }}
                >{t('common.copy', 'Copy')}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
