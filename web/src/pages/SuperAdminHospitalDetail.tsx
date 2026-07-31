import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  ChevronLeft,
  Building2,
  Eye,
  Edit2,
  Save,
  Users,
  Activity,
  TrendingUp,
  LogIn,
  ShieldCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { saveToken } from '../hooks/useAuth';
import { useApiQuery, useQueryClient } from '../hooks/useApiQuery';
import { api } from '../lib/apiClient';
import { queryKeys } from '../lib/queryKeys';
import { formatDisplayDate } from '../lib/date-utils';

interface HospitalUser {
  id: number;
  email: string;
  name: string;
  role: string;
  created_at: string;
}

interface HospitalDetail {
  hospital: {
    id: number;
    name: string;
    subdomain: string;
    status: string;
    plan: string;
    created_at: string;
    updated_at?: string;
    addons?: string;
  };
  users: HospitalUser[];
  stats: { patients: number; totalBilled: number; totalPaid: number };
}

interface ImpersonationResponse {
  token: string;
  tenant: { name: string; id: number; subdomain?: string };
  targetUser?: { id: number; name: string; email: string; role: string };
  redirectUrl: string;
}

const roleLabel = (role: string) => role
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (char) => char.toUpperCase());

export default function SuperAdminHospitalDetail() {
  const { t } = useTranslation(['super-admin', 'common']);
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', status: '', plan: '' });
  const [addons, setAddons] = useState<string[]>([]);
  const [impersonatingUserId, setImpersonatingUserId] = useState<number | 'admin' | null>(null);
  const navigate = useNavigate();

  const toggleFeature = async (feature: string, enabled: boolean) => {
    let newAddons = [...addons];
    if (enabled && !newAddons.includes(feature)) {
      newAddons.push(feature);
    } else if (!enabled) {
      newAddons = newAddons.filter(f => f !== feature);
    }
    try {
      await api.patch(`/api/admin/hospitals/${id}/addons`, { addons: newAddons });
      setAddons(newAddons);
      toast.success(t('super-admin.feature_updated'));
    } catch {
      toast.error(t('super-admin.failed_to_update'));
    }
  };

  const { data, isLoading: loading } = useApiQuery<HospitalDetail>(
    queryKeys.superAdmin.hospitalDetail(id ?? ''),
    `/api/admin/hospitals/${id}`,
    {
      enabled: !!id,
      onSuccess: (res: HospitalDetail) => {
        setEditForm({ name: res.hospital.name, status: res.hospital.status, plan: res.hospital.plan });
        try {
          const parsed = JSON.parse(res.hospital.addons || '[]');
          if (Array.isArray(parsed)) setAddons(parsed);
        } catch { /* ignore */ }
      },
    } as any,
  );

  if (data && editForm.name === '' && data.hospital.name) {
    setEditForm({ name: data.hospital.name, status: data.hospital.status, plan: data.hospital.plan });
  }

  const usersByRole = useMemo(() => {
    const grouped = new Map<string, HospitalUser[]>();
    for (const user of data?.users ?? []) {
      const key = user.role || 'unknown';
      grouped.set(key, [...(grouped.get(key) ?? []), user]);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [data?.users]);

  const handleSave = async () => {
    try {
      await api.put(`/api/admin/hospitals/${id}`, editForm);
      toast.success(t('super-admin.hospital_updated'));
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.superAdmin.hospitalDetail(id ?? '') });
    } catch { toast.error(t('super-admin.failed_to_update')); }
  };

  const handleImpersonate = async (targetUser?: HospitalUser) => {
    const pendingId = targetUser?.id ?? 'admin';
    setImpersonatingUserId(pendingId);
    try {
      const res = await api.post<ImpersonationResponse>(`/api/admin/impersonate/${id}`, targetUser ? {
        targetUserId: targetUser.id,
        reason: 'support_debug',
      } : {
        reason: 'support_debug',
      });
      saveToken(res.token);
      const label = res.targetUser ? `${res.targetUser.name} (${roleLabel(res.targetUser.role)})` : 'hospital admin';
      toast.success(`Opening as ${label}`);
      navigate(res.redirectUrl);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('super-admin.failed_to_impersonate');
      toast.error(message || t('super-admin.failed_to_impersonate'));
    } finally {
      setImpersonatingUserId(null);
    }
  };

  if (loading) return (<div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8"><div className="skeleton h-8 w-1/3 mb-6" /><div className="grid grid-cols-3 gap-4 mb-6">{[...Array(3)].map((_, i) => <div key={i} className="card p-5"><div className="skeleton h-16 w-full" /></div>)}</div></div>);
  if (!data) return (<div className="flex items-center justify-center py-20"><p className="text-[var(--color-text-muted)]">{t('super-admin:hospitalList')}</p></div>);

  const { hospital, users, stats } = data;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/super-admin/hospitals')} className="btn-ghost p-2"><ChevronLeft className="w-5 h-5" /></button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] flex items-center gap-2"><Building2 className="w-6 h-6 text-[var(--color-primary)]" />{hospital.name}</h1>
            <p className="text-sm text-[var(--color-text-muted)] font-data">{hospital.subdomain}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleImpersonate()} disabled={impersonatingUserId !== null} className="btn-secondary">
            <Eye className="w-4 h-4" /> {impersonatingUserId === 'admin' ? 'Opening...' : 'Login as admin'}
          </button>
          {!editing ? (<button onClick={() => setEditing(true)} className="btn-ghost"><Edit2 className="w-4 h-4" /> {t('common:edit')}</button>) : (<button onClick={handleSave} className="btn-primary"><Save className="w-4 h-4" /> {t('common:save')}</button>)}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card p-5 flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center"><Activity className="w-5 h-5 text-blue-600" /></div><div><p className="text-xs text-[var(--color-text-muted)]">{t('super-admin:totalPatientsLabel')}</p><p className="text-xl font-bold text-[var(--color-text-primary)]">{stats.patients.toLocaleString()}</p></div></div>
        <div className="card p-5 flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center"><TrendingUp className="w-5 h-5 text-emerald-600" /></div><div><p className="text-xs text-[var(--color-text-muted)]">{t('super-admin:revenue')}</p><p className="text-xl font-bold text-[var(--color-text-primary)]">৳{stats.totalBilled.toLocaleString()}</p></div></div>
        <div className="card p-5 flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center"><Users className="w-5 h-5 text-indigo-600" /></div><div><p className="text-xs text-[var(--color-text-muted)]">{t('super-admin:hospitalUsers')}</p><p className="text-xl font-bold text-[var(--color-text-primary)]">{users.length}</p></div></div>
      </div>

      <div className="card p-5 mb-6">
        <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-4">{t('super-admin:hospitalInfo')}</h3>
        {editing ? (<div className="grid grid-cols-1 sm:grid-cols-3 gap-4"><div><label className="block text-sm font-medium text-[var(--color-text-muted)] mb-1">{t('super-admin:hospitalName')}</label><input className="input-field w-full" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div><div><label className="block text-sm font-medium text-[var(--color-text-muted)] mb-1">{t('common:status')}</label><select className="input-field w-full" value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}><option value="active">{t('super-admin:activeStatus')}</option><option value="inactive">{t('super-admin:inactiveStatus')}</option><option value="suspended">{t('super-admin:suspendedStatus')}</option></select></div><div><label className="block text-sm font-medium text-[var(--color-text-muted)] mb-1">{t('super-admin:planType')}</label><select className="input-field w-full" value={editForm.plan} onChange={(e) => setEditForm({ ...editForm, plan: e.target.value })}><option value="basic">{t('super-admin:basic')}</option><option value="professional">{t('super-admin:professional')}</option><option value="enterprise">{t('super-admin:enterprise')}</option></select></div></div>)
        : (<div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm"><div><p className="text-[var(--color-text-muted)]">{t('super-admin:subdomain')}</p><p className="font-medium font-data">{hospital.subdomain}</p></div><div><p className="text-[var(--color-text-muted)]">{t('super-admin:plan')}</p><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${hospital.plan === 'enterprise' ? 'bg-purple-100 text-purple-700' : hospital.plan === 'professional' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>{t(`super-admin:${hospital.plan}`)}</span></div><div><p className="text-[var(--color-text-muted)]">{t('common:status')}</p><span className={`inline-flex items-center gap-1 text-xs font-medium ${hospital.status === 'active' ? 'text-emerald-600' : 'text-slate-400'}`}><span className={`w-1.5 h-1.5 rounded-full ${hospital.status === 'active' ? 'bg-emerald-500' : 'bg-slate-400'}`} />{t(`super-admin:${hospital.status}Status`) || hospital.status}</span></div><div><p className="text-[var(--color-text-muted)]">{t('common:date')}</p><p className="font-medium text-sm">{formatDisplayDate(hospital.created_at)}</p></div></div>)}
      </div>

      <div className="card p-5 mb-6 border-indigo-100 bg-indigo-50/30">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-indigo-600 mt-0.5" />
          <div>
            <h3 className="font-semibold text-[var(--color-text-primary)]">Role-based support login</h3>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              Super admin can open a short-lived audited session as a specific hospital user. Non-admin users keep their own role permissions, so support can reproduce exact receptionist, doctor, lab, pharmacy, or accounting issues.
            </p>
          </div>
        </div>
      </div>

      <div className="card p-5 mb-6">
        <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-4">Hospital Features</h3>
        <div className="space-y-3">
          <label className="flex items-center justify-between p-3 bg-[var(--color-bg)] rounded-lg">
            <div>
              <div className="font-medium text-sm">AI Patient Summary</div>
              <div className="text-xs text-[var(--color-text-muted)]">Enable AI-powered clinical overviews for doctors</div>
            </div>
            <input
              type="checkbox"
              checked={addons.includes('ai-summary')}
              onChange={(e) => toggleFeature('ai-summary', e.target.checked)}
              className="toggle"
            />
          </label>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">{t('super-admin:hospitalUsers')} ({users.length})</h3>
          <div className="flex flex-wrap gap-2">
            {usersByRole.map(([role, roleUsers]) => (
              <span key={role} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                {roleLabel(role)} <span className="font-data">{roleUsers.length}</span>
              </span>
            ))}
          </div>
        </div>

        {users.length === 0 ? (
          <div className="card p-8 text-center text-[var(--color-text-muted)]">{t('common:noData')}</div>
        ) : usersByRole.map(([role, roleUsers]) => (
          <div key={role} className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
              <div>
                <h4 className="font-semibold text-[var(--color-text-primary)]">{roleLabel(role)}</h4>
                <p className="text-xs text-[var(--color-text-muted)]">{roleUsers.length} user{roleUsers.length === 1 ? '' : 's'} in this role</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>{t('common:name')}</th><th>{t('common:email')}</th><th>{t('common:status')}</th><th>{t('common:date')}</th><th>{t('common:actions')}</th></tr></thead>
                <tbody>
                  {roleUsers.map((user) => (
                    <tr key={user.id}>
                      <td className="font-medium">{user.name}</td>
                      <td className="font-data text-sm text-[var(--color-text-secondary)]">{user.email}</td>
                      <td><span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">{roleLabel(user.role)}</span></td>
                      <td className="text-sm text-[var(--color-text-muted)]">{formatDisplayDate(user.created_at)}</td>
                      <td>
                        <button
                          onClick={() => handleImpersonate(user)}
                          disabled={impersonatingUserId !== null}
                          className="btn-secondary text-xs"
                          title={`Login as ${user.name}`}
                        >
                          <LogIn className="w-3.5 h-3.5" /> {impersonatingUserId === user.id ? 'Opening...' : `Login as ${roleLabel(user.role)}`}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
