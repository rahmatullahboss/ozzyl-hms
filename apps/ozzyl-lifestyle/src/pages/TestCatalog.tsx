import { useState, useEffect, useCallback } from 'react';
import { FlaskConical, Plus, X, Search } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import { authHeader } from '../utils/auth';
import { useTranslation } from 'react-i18next';

interface Test {
  id: number; patient_id?: number; test_name: string; status: string;
  result?: string; date: string; patient_name?: string;
}

const STATUS_BADGE: Record<string, { l: string; b: string }> = {
  pending: { l: 'Pending', b: 'badge-warning' }, completed: { l: 'Completed', b: 'badge-success' }, cancelled: { l: 'Cancelled', b: 'badge-danger' },
};


export default function TestCatalog({ role = 'hospital_admin' }: { role?: string }) {
  const [tests, setTests] = useState<Test[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ patientId: '', testName: '' });
  const { t } = useTranslation(['laboratory', 'common']);

  // ESC-to-close modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowCreate(false); setForm({ patientId: '', testName: '' }); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fetchTests = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      const { data } = await axios.get('/api/tests', { params, headers: authHeader() });
      setTests(data.tests ?? []);
    } catch { setTests([]); } finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { fetchTests(); }, [fetchTests]);

  const displayed = tests.filter(t =>
    (!search || t.test_name.toLowerCase().includes(search.toLowerCase()) || t.patient_name?.toLowerCase().includes(search.toLowerCase()))
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/tests', { patientId: parseInt(form.patientId), testName: form.testName }, { headers: authHeader() });
      toast.success(t('laboratory.testOrdered')); setShowCreate(false); setForm({ patientId: '', testName: '' }); fetchTests();
    } catch (err) { toast.error(axios.isAxiosError(err) ? err.response?.data?.error ?? t('common.failed') : t('common.failed')); } finally { setSaving(false); }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div><h1 className="page-title">Lab Test Catalog</h1><p className="section-subtitle mt-1">Manage lab tests, orders, and results</p></div>
          <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus className="w-4 h-4" /> Order Test</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard title="Total Tests" value={tests.length} loading={loading} icon={<FlaskConical className="w-5 h-5"/>} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" />
          <KPICard title="Pending" value={tests.filter(t => t.status === 'pending').length} loading={loading} icon={<FlaskConical className="w-5 h-5"/>} iconBg="bg-amber-50 text-amber-600" />
          <KPICard title="Completed" value={tests.filter(t => t.status === 'completed').length} loading={loading} icon={<FlaskConical className="w-5 h-5"/>} iconBg="bg-emerald-50 text-emerald-600" />
        </div>

        <div className="card p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" /><input type="text" placeholder={t("laboratory.searchTestOrPatient")} value={search} onChange={e => setSearch(e.target.value)} className="input pl-9" /></div>
          <div className="flex border border-[var(--color-border)] rounded-lg overflow-hidden text-sm">
            {[['', 'All'], ['pending', 'Pending'], ['completed', 'Completed']].map(([val, label]) => (
              <button key={val} onClick={() => setStatusFilter(val)} className={`px-3 py-2 font-medium transition-colors ${statusFilter === val ? 'bg-[var(--color-primary)] text-white' : 'bg-white hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>{label}</button>
            ))}
          </div>
        </div>

        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>#</th><th>Test Name</th><th>Patient</th><th>Date</th><th>Status</th><th>Result</th></tr></thead><tbody>
          {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
          : displayed.length === 0 ? <tr><td colSpan={6} className="py-16 text-center text-[var(--color-text-muted)]">No tests found</td></tr>
          : displayed.map((test, idx) => {
              const st = STATUS_BADGE[test.status] ?? STATUS_BADGE.pending;
              return (<tr key={test.id}>
                <td className="text-[var(--color-text-muted)]">{idx + 1}</td>
                <td className="font-medium">{test.test_name}</td>
                <td>{test.patient_name || '—'}</td>
                <td className="font-data text-sm">{test.date}</td>
                <td><span className={`badge ${st.b}`}>{st.l}</span></td>
                <td className="text-sm max-w-[200px] truncate">{test.result || '—'}</td>
              </tr>);
            })}
        </tbody></table></div></div>

        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]"><h3 className="font-semibold">Order Lab Test</h3><button onClick={() => setShowCreate(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button></div>
              <form onSubmit={handleCreate} className="p-5 space-y-4">
                <div><label className="label">{t('laboratory.patientIdRequired')}</label><input className="input" type="number" required value={form.patientId} onChange={e => setForm({ ...form, patientId: e.target.value })} /></div>
                <div><label className="label">{t('laboratory.testNameRequired')}</label><input className="input" required value={form.testName} onChange={e => setForm({ ...form, testName: e.target.value })} placeholder={t("laboratory.testNameExample")} /></div>
                <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Ordering…' : 'Order Test'}</button></div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
