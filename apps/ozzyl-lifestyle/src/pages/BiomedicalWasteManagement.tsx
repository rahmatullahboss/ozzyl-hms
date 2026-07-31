import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Biohazard, Plus, X, RefreshCw, CheckCircle, Truck } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { authHeader } from '../utils/auth';

interface Category { id: number; category_code: string; category_name: string; color: string; disposal_method?: string; }
interface Collection { id: number; collection_number: string; collection_date: string; department: string; category_name?: string; category_color?: string; weight_kg: number; bag_count: number; status: string; manifest_number?: string; disposal_certificate?: string; }
interface Stats { today: { collections: number; total_weight_kg: number; total_bags: number }; pending_disposal: number; month_weight_kg: number; }

const STATUS_BADGE: Record<string, string> = { collected: 'bg-gray-100 text-gray-600', in_transit: 'bg-blue-100 text-blue-700', disposed: 'badge-success', reported: 'bg-emerald-100 text-emerald-700' };
const COLOR_MAP: Record<string, string> = { yellow: 'bg-yellow-400', red: 'bg-red-500', white: 'bg-white border border-gray-300', blue: 'bg-blue-500' };
const TABS = ['collections', 'categories'] as const;
type Tab = typeof TABS[number];

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useTranslation('inventory');
  return (<div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm"><div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto"><div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]"><h3 className="font-semibold">{title}</h3><button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button></div><div className="p-5 space-y-4">{children}</div></div></div>);
}

function CollectionsTab() {
  const [items, setItems] = useState<Collection[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ collection_date: new Date().toISOString().split('T')[0], department: '', category_id: '', weight_kg: '', bag_count: '1', collected_by: '', handover_to: '', manifest_number: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, sRes, catRes] = await Promise.all([
        axios.get('/api/biomedical-waste/collections', { headers: authHeader() }),
        axios.get('/api/biomedical-waste/stats', { headers: authHeader() }),
        axios.get('/api/biomedical-waste/categories', { headers: authHeader() }),
      ]);
      setItems(cRes.data?.data ?? []); setStats(sRes.data ?? null); setCats(catRes.data?.data ?? []);
    } catch { setItems([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id: number, status: string) => {
    try { await axios.put(`/api/biomedical-waste/collections/${id}/status`, { status }, { headers: authHeader() }); toast.success(`→ ${status}`); load(); } catch { toast.error(t('inventory.failed')); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const cat = cats.find(c => c.id === Number(form.category_id));
    try {
      await axios.post('/api/biomedical-waste/collections', { ...form, category_id: Number(form.category_id), category_name: cat?.category_name, weight_kg: Number(form.weight_kg), bag_count: Number(form.bag_count) || 1 }, { headers: authHeader() });
      toast.success(t('inventory.collection_recorded')); setShowForm(false); load();
    } catch { toast.error(t('inventory.failed')); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)]">Today Collections</p><p className="text-2xl font-bold">{stats.today.collections ?? 0}</p></div>
          <div className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)]">Today Weight</p><p className="text-2xl font-bold">{Number(stats.today.total_weight_kg ?? 0).toFixed(1)} kg</p></div>
          <div className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)]">Pending Disposal</p><p className="text-2xl font-bold text-amber-600">{stats.pending_disposal}</p></div>
          <div className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)]">30-Day Total</p><p className="text-2xl font-bold">{Number(stats.month_weight_kg ?? 0).toFixed(1)} kg</p></div>
        </div>
      )}
      <div className="flex justify-end"><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> Record Collection</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Collection #</th><th>Date</th><th>Department</th><th>Category</th><th>Weight</th><th>Bags</th><th>Manifest</th><th>Status</th><th></th></tr></thead><tbody>
        {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(9)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
        : items.length === 0 ? <tr><td colSpan={9} className="text-center py-8 text-[var(--color-text-muted)]">No collections</td></tr>
        : items.map(c => (
          <tr key={c.id}>
            <td className="font-mono text-sm font-bold text-[var(--color-primary)]">{c.collection_number}</td>
            <td className="text-sm">{c.collection_date}</td>
            <td className="text-sm">{c.department}</td>
            <td><div className="flex items-center gap-2"><span className={`w-3 h-3 rounded-full ${COLOR_MAP[c.category_color ?? ''] ?? 'bg-gray-300'}`} /><span className="text-xs">{c.category_name ?? '—'}</span></div></td>
            <td className="font-data">{c.weight_kg} kg</td>
            <td className="font-data text-center">{c.bag_count}</td>
            <td className="font-mono text-xs">{c.manifest_number ?? '—'}</td>
            <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[c.status] ?? ''}`}>{c.status.replace('_', ' ')}</span></td>
            <td><div className="flex gap-1">
              {c.status === 'collected' && <button onClick={() => updateStatus(c.id, 'in_transit')} className="btn-ghost text-xs p-1" title="In Transit"><Truck className="w-3.5 h-3.5 text-blue-600" /></button>}
              {c.status === 'in_transit' && <button onClick={() => updateStatus(c.id, 'disposed')} className="btn-ghost text-xs p-1" title="Disposed"><CheckCircle className="w-3.5 h-3.5 text-green-600" /></button>}
            </div></td>
          </tr>
        ))}
      </tbody></table></div></div>
      {showForm && (
        <Modal title="Record Waste Collection" onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('common.date_')}</label><input type="date" className="input w-full" required value={form.collection_date} onChange={e => setForm({...form, collection_date: e.target.value})} /></div>
              <div><label className="label">Department *</label><input className="input w-full" required value={form.department} onChange={e => setForm({...form, department: e.target.value})} placeholder={t("common.ot_lab_ward")} /></div>
            </div>
            <div><label className="label">{t('common.category_')}</label><select className="input w-full" required value={form.category_id} onChange={e => setForm({...form, category_id: e.target.value})}><option value="">Select...</option>{cats.map(c => <option key={c.id} value={c.id}>{c.category_code} — {c.category_name}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('common.weight_kg_')}</label><input className="input w-full" required type="number" step="0.1" min="0.1" value={form.weight_kg} onChange={e => setForm({...form, weight_kg: e.target.value})} /></div>
              <div><label className="label">{t('common.bags')}</label><input className="input w-full" type="number" min="1" value={form.bag_count} onChange={e => setForm({...form, bag_count: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('common.collected_by')}</label><input className="input w-full" value={form.collected_by} onChange={e => setForm({...form, collected_by: e.target.value})} /></div>
              <div><label className="label">{t('common.manifest_')}</label><input className="input w-full" value={form.manifest_number} onChange={e => setForm({...form, manifest_number: e.target.value})} /></div>
            </div>
            <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Record'}</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function CategoriesTab() {
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const { data } = await axios.get('/api/biomedical-waste/categories', { headers: authHeader() }); setItems(data?.data ?? []); } catch { setItems([]); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);
  const seed = async () => { setSeeding(true); try { await axios.post('/api/biomedical-waste/categories/seed', {}, { headers: authHeader() }); toast.success('Defaults seeded'); load(); } catch { toast.error('Failed'); } finally { setSeeding(false); } };
  return (
    <div className="space-y-4">
      <div className="flex justify-end">{items.length === 0 && <button onClick={seed} disabled={seeding} className="btn-primary">{seeding ? 'Seeding...' : 'Seed Default Categories'}</button>}</div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Code</th><th>Color</th><th>Name</th><th>Disposal Method</th><th></th></tr></thead><tbody>
        {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(5)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
        : items.length === 0 ? <tr><td colSpan={5} className="text-center py-8 text-[var(--color-text-muted)]">No categories. Click "Seed Default" to add standard categories.</td></tr>
        : items.map(c => (
          <tr key={c.id}>
            <td className="font-bold">{c.category_code}</td>
            <td><span className={`inline-block w-6 h-6 rounded ${COLOR_MAP[c.color] ?? 'bg-gray-300'}`} /></td>
            <td className="text-sm">{c.category_name}</td>
            <td className="text-xs text-[var(--color-text-muted)]">{c.disposal_method ?? '—'}</td>
            <td><button onClick={async () => { await axios.delete(`/api/biomedical-waste/categories/${c.id}`, { headers: authHeader() }); load(); }} className="btn-ghost text-xs text-red-400 p-1"><X className="w-3.5 h-3.5" /></button></td>
          </tr>
        ))}
      </tbody></table></div></div>
    </div>
  );
}

export default function BiomedicalWasteManagement({ role }: { role?: string }) {
  const [tab, setTab] = useState<Tab>('collections');
  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500 to-orange-600 flex items-center justify-center shadow-lg shadow-yellow-500/20"><Biohazard className="w-5 h-5 text-white" /></div>
          <div><h1 className="page-title">Biomedical Waste</h1><p className="section-subtitle">Waste categorization, collection & disposal tracking</p></div>
        </div></div>
        <div className="card p-1.5 flex gap-1">{TABS.map(t => (<button key={t} onClick={() => setTab(t)} className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>{t === 'collections' ? 'Collections' : 'Categories'}</button>))}</div>
        {tab === 'collections' ? <CollectionsTab /> : <CategoriesTab />}
      </div>
    </DashboardLayout>
  );
}
