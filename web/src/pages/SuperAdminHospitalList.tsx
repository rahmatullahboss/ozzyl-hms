import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Building2, Search, Eye, Edit2, Power, Plus, ChevronLeft, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { saveToken } from '../hooks/useAuth';
import { useApiQuery, useQueryClient } from '../hooks/useApiQuery';
import { api } from '../lib/apiClient';
import { queryKeys } from '../lib/queryKeys';
import { formatDisplayDate } from '../lib/date-utils';

interface Hospital { id: number; name: string; subdomain: string; status: string; plan: string; created_at: string; user_count: number; patient_count: number; }

export default function SuperAdminHospitalList() {
  const { t } = useTranslation(['super-admin', 'common']);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => { if (searchParams.get('action') === 'create') setShowCreate(true); }, []);

  const { data: hospitalsData, isLoading: loading } = useApiQuery<{ hospitals: Hospital[] }>(queryKeys.superAdmin.hospitals(), '/api/admin/hospitals');
  const hospitals = hospitalsData?.hospitals ?? [];

  const handleImpersonate = async (id: number) => {
    try {
      const data = await api.post<{ token: string; tenant: { name: string; id: number }; redirectUrl: string }>(`/api/admin/impersonate/${id}`, { reason: 'support_debug' });
      // P0-34: tokens are kept in memory (tokenStore), so navigate in this tab.
      // A new tab would not receive the in-memory support token.
      saveToken(data.token);
      navigate(data.redirectUrl);
    } catch { toast.error(t('super-admin.failed_to_impersonate')); }
  };

  const handleToggleStatus = async (hospital: Hospital) => {
    const newStatus = hospital.status === 'active' ? 'inactive' : 'active';
    try {
      await api.put(`/api/admin/hospitals/${hospital.id}`, { name: hospital.name, status: newStatus, plan: hospital.plan });
      toast.success(t('superAdmin.hospitalStatusChanged', { status: newStatus }));
      queryClient.invalidateQueries({ queryKey: queryKeys.superAdmin.hospitals() });
    } catch { toast.error(t('super-admin.failed_to_update_hospital')); }
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCreating(true);
    const formData = new FormData(e.currentTarget);
    try {
      await api.post('/api/admin/hospitals', { name: formData.get('name'), subdomain: formData.get('subdomain'), adminEmail: formData.get('adminEmail'), adminName: formData.get('adminName'), adminPassword: formData.get('adminPassword') });
      toast.success(t('super-admin.hospital_created'));
      setShowCreate(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.superAdmin.hospitals() });
    } catch (err: unknown) {
      const errMsg = (err as { message?: string })?.message || 'Failed to create';
      toast.error(errMsg);
    } finally { setCreating(false); }
  };

  const filtered = hospitals.filter((h) => {
    const matchesSearch = h.name.toLowerCase().includes(search.toLowerCase()) || h.subdomain.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === 'all' || h.status === filter;
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/super-admin/dashboard')} className="btn-ghost p-2"><ChevronLeft className="w-5 h-5" /></button>
          <div><h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('super-admin:hospitals')}</h1><p className="text-sm text-[var(--color-text-muted)]">{hospitals.length} {t('super-admin:totalHospitals')}</p></div>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('super-admin:addHospital')}</button>
      </div>
      <div className="card p-4 mb-6"><div className="flex flex-col sm:flex-row gap-3"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" /><input type="text" placeholder={t('super-admin:searchHospital')} value={search} onChange={(e) => setSearch(e.target.value)} className="input-field pl-9 w-full" /></div><div className="flex gap-1 bg-[var(--color-bg-secondary)] rounded-lg p-1">{['all', 'active', 'inactive', 'suspended'].map((f) => (<button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${filter === f ? 'bg-[var(--color-bg-card)] text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'}`}>{t(`super-admin:${f}Status`) || f.charAt(0).toUpperCase() + f.slice(1)}</button>))}</div></div></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>{t('super-admin:hospital')}</th><th>{t('super-admin:slug')}</th><th>{t('super-admin:plan')}</th><th>{t('common:status')}</th><th>{t('super-admin:hospitalUsers')}</th><th>{t('super-admin:totalPatientsLabel')}</th><th>{t('common:date')}</th><th>{t('common:actions')}</th></tr></thead><tbody>
        {loading ? ([...Array(5)].map((_, i) => (<tr key={i}>{[...Array(8)].map((_, j) => (<td key={j}><div className="skeleton h-4 w-full" /></td>))}</tr>)))
        : filtered.length === 0 ? (<tr><td colSpan={8} className="py-10 text-center text-[var(--color-text-muted)]">{t('super-admin:noHospitalsFound')}</td></tr>)
        : (filtered.map((h) => (<tr key={h.id}><td className="font-medium">{h.name}</td><td className="font-data text-sm text-[var(--color-text-secondary)]">{h.subdomain}</td><td><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${h.plan === 'enterprise' ? 'bg-purple-100 text-purple-700' : h.plan === 'professional' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>{t(`super-admin:${h.plan}`)}</span></td><td><span className={`inline-flex items-center gap-1 text-xs font-medium ${h.status === 'active' ? 'text-emerald-600' : h.status === 'suspended' ? 'text-red-500' : 'text-slate-400'}`}><span className={`w-1.5 h-1.5 rounded-full ${h.status === 'active' ? 'bg-emerald-500' : h.status === 'suspended' ? 'bg-red-500' : 'bg-slate-400'}`} />{t(`super-admin:${h.status}Status`) || h.status}</span></td><td className="font-data text-sm">{h.user_count}</td><td className="font-data text-sm">{h.patient_count}</td><td className="text-sm text-[var(--color-text-muted)]">{formatDisplayDate(h.created_at)}</td><td><div className="flex items-center gap-1"><button onClick={() => navigate(`/super-admin/hospitals/${h.id}`)} className="btn-ghost p-1.5" title={t('super-admin:hospitalDetails')}><Edit2 className="w-3.5 h-3.5" /></button><button onClick={() => handleImpersonate(h.id)} className="btn-ghost p-1.5 text-indigo-600" title={t('common:view')}><Eye className="w-3.5 h-3.5" /></button><button onClick={() => handleToggleStatus(h)} className={`btn-ghost p-1.5 ${h.status === 'active' ? 'text-amber-600' : 'text-emerald-600'}`} title={h.status === 'active' ? t('super-admin:inactiveStatus') : t('super-admin:activeStatus')}><Power className="w-3.5 h-3.5" /></button></div></td></tr>)))}
      </tbody></table></div></div>
      {showCreate && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"><div className="card max-w-md w-full mx-4 p-6"><div className="flex items-center justify-between mb-5"><h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('super-admin:createHospital')}</h2><button onClick={() => setShowCreate(false)} className="btn-ghost p-1"><X className="w-5 h-5" /></button></div><form onSubmit={handleCreate} className="space-y-4"><div><label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">{t('super-admin:hospitalName')}</label><input name="name" required className="input-field w-full" placeholder={t("superAdmin.hospitalNameExample")} /></div><div><label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">{t('super-admin:subdomain')}</label><input name="subdomain" required className="input-field w-full" placeholder={t("superAdmin.subdomainExample")} pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$" /></div><div><label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">{t('super-admin:adminName')}</label><input name="adminName" required className="input-field w-full" placeholder={t("superAdmin.adminFullNamePlaceholder")} /></div><div><label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">{t('super-admin:adminEmail')}</label><input name="adminEmail" type="email" required className="input-field w-full" placeholder={t("superAdmin.adminEmailPlaceholder")} /></div><div><label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">{t('common:password')}</label><input name="adminPassword" type="password" required minLength={8} className="input-field w-full" placeholder={t('common:password')} /></div><div className="flex gap-3 pt-2"><button type="button" onClick={() => setShowCreate(false)} className="btn-ghost flex-1">{t('common:cancel')}</button><button type="submit" disabled={creating} className="btn-primary flex-1">{creating ? t('common:loading') : t('super-admin:createHospital')}</button></div></form></div></div>)}
    </div>
  );
}
