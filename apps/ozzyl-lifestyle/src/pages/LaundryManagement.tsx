import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Shirt, Plus, X, RefreshCw, CheckCircle, Truck, Clock } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { authHeader } from '../utils/auth';

interface LinenType { id: number; linen_name: string; category: string; par_level: number; }
interface Collection { id: number; collection_number: string; collected_from: string; collection_date: string; total_items: number; status: string; delivered_at?: string; }
interface Stats { today_collections: number; in_process: number; ready_for_delivery: number; today_items: number; }

const STATUS_BADGE: Record<string, string> = { collected: 'bg-gray-100 text-gray-600', washing: 'bg-blue-100 text-blue-700', drying: 'bg-cyan-100 text-cyan-700', ironing: 'bg-amber-100 text-amber-700', ready: 'badge-success', delivered: 'bg-green-100 text-green-700' };
const STATUS_FLOW = ['collected','washing','drying','ironing','ready','delivered'];
const TABS = ['collections', 'linen-types'] as const;
type Tab = typeof TABS[number];

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]"><h3 className="font-semibold">{title}</h3><button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button></div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function CollectionsTab() {
  const [items, setItems] = useState<Collection[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [linens, setLinens] = useState<LinenType[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [form, setForm] = useState({ collected_from: '', items: [{ linen_type_id: 0, quantity_dirty: 1 }] });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, sRes, lRes] = await Promise.all([
        axios.get('/api/laundry/collections', { params: { date }, headers: authHeader() }),
        axios.get('/api/laundry/stats', { headers: authHeader() }),
        axios.get('/api/laundry/linen-types', { headers: authHeader() }),
      ]);
      setItems(cRes.data?.data ?? []); setStats(sRes.data ?? null); setLinens(lRes.data?.data ?? []);
    } catch { setItems([]); } finally { setLoading(false); }
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id: number, status: string) => {
    try { await axios.put(`/api/laundry/collections/${id}/status`, { status }, { headers: authHeader() }); toast.success(`Status → ${status}`); load(); } catch { toast.error(t('common.operationFailed')); }
  };

  const nextStatus = (current: string) => {
    const idx = STATUS_FLOW.indexOf(current);
    return idx >= 0 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = form.items.filter(i => i.linen_type_id > 0);
    if (!form.collected_from || validItems.length === 0) { toast.error(t('laundry.wardAndItemRequired')); return; }
    setSaving(true);
    try {
      await axios.post('/api/laundry/collections', { collected_from: form.collected_from, collection_date: date, items: validItems }, { headers: authHeader() });
      toast.success(t('laundry.collectionRecorded')); setShowForm(false); load();
    } catch { toast.error(t('common.operationFailed')); } finally { setSaving(false); }
  };

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { linen_type_id: 0, quantity_dirty: 1 }] }));

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { l: "Today's Collections", v: stats.today_collections },
            { l: 'In Process', v: stats.in_process, c: 'text-blue-600' },
            { l: 'Ready for Delivery', v: stats.ready_for_delivery, c: 'text-green-600' },
            { l: "Today's Items", v: stats.today_items },
          ].map(k => <div key={k.l} className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)]">{k.l}</p><p className={`text-2xl font-bold mt-1 ${k.c ?? ''}`}>{k.v}</p></div>)}
        </div>
      )}
      <div className="flex gap-3 items-end">
        <div><label className="label">{t('inventory.date')}</label><input type="date" className="input w-40" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div className="flex-1" />
        <button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> New Collection</button>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Collection #</th><th>From</th><th>Date</th><th>Items</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : items.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">No collections</td></tr>
              : items.map(c => {
                const next = nextStatus(c.status);
                return (
                  <tr key={c.id}>
                    <td className="font-mono text-sm font-bold text-[var(--color-primary)]">{c.collection_number}</td>
                    <td className="font-medium">{c.collected_from}</td>
                    <td className="text-sm">{c.collection_date}</td>
                    <td className="font-data text-center">{c.total_items}</td>
                    <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[c.status] ?? 'badge-neutral'}`}>{c.status}</span></td>
                    <td>{next && <button onClick={() => updateStatus(c.id, next)} className="btn-ghost text-xs p-1" title={`→ ${next}`}>{next === 'delivered' ? <Truck className="w-3.5 h-3.5 text-green-600" /> : <CheckCircle className="w-3.5 h-3.5 text-blue-600" />}</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {showForm && (
        <Modal title="New Laundry Collection" onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="label">{t('inventory.collectedFromRequired')}</label><input className="input w-full" required value={form.collected_from} onChange={e => setForm({...form, collected_from: e.target.value})} placeholder={t("inventory.wardOtIcuExample")} /></div>
            <div><label className="label">{t('inventory.items')}</label>
              {form.items.map((item, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <select className="input flex-1" value={item.linen_type_id} onChange={e => { const items = [...form.items]; items[i].linen_type_id = Number(e.target.value); setForm({...form, items}); }}>
                    <option value={0}>Select linen...</option>
                    {linens.map(l => <option key={l.id} value={l.id}>{l.linen_name}</option>)}
                  </select>
                  <input type="number" className="input w-20" min={1} value={item.quantity_dirty} onChange={e => { const items = [...form.items]; items[i].quantity_dirty = Number(e.target.value); setForm({...form, items}); }} />
                  {form.items.length > 1 && <button type="button" onClick={() => setForm(f => ({...f, items: f.items.filter((_, j) => j !== i)}))} className="btn-ghost p-1 text-red-400"><X className="w-3.5 h-3.5" /></button>}
                </div>
              ))}
              <button type="button" onClick={addItem} className="text-xs text-[var(--color-primary)] hover:underline">+ Add item</button>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Record'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function LinenTypesTab() {
  const [items, setItems] = useState<LinenType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ linen_name: '', category: 'general', par_level: '0' });
  const load = useCallback(async () => { setLoading(true); try { const { data } = await axios.get('/api/laundry/linen-types', { headers: authHeader() }); setItems(data?.data ?? []); } catch { setItems([]); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);
  const handleSubmit = async (e: React.FormEvent) => { e.preventDefault(); setSaving(true); try { await axios.post('/api/laundry/linen-types', { ...form, par_level: Number(form.par_level) }, { headers: authHeader() }); toast.success('Added'); setShowForm(false); load(); } catch { toast.error(t('common.operationFailed')); } finally { setSaving(false); } };
  const CAT_BADGE: Record<string, string> = { general: 'badge-neutral', ot: 'bg-blue-100 text-blue-700', icu: 'bg-red-100 text-red-700', pediatric: 'bg-green-100 text-green-700', maternity: 'bg-pink-100 text-pink-700' };
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> Add Type</button></div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Linen Name</th><th>Category</th><th>Par Level</th><th></th></tr></thead>
            <tbody>
              {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(4)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : items.length === 0 ? <tr><td colSpan={4} className="text-center py-8 text-[var(--color-text-muted)]">No linen types</td></tr>
              : items.map(l => (
                <tr key={l.id}>
                  <td className="font-medium">{l.linen_name}</td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CAT_BADGE[l.category] ?? 'badge-neutral'}`}>{l.category}</span></td>
                  <td className="font-data text-center">{l.par_level}</td>
                  <td><button onClick={async () => { await axios.delete(`/api/laundry/linen-types/${l.id}`, { headers: authHeader() }); load(); }} className="btn-ghost text-xs text-red-400 p-1"><X className="w-3.5 h-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showForm && (
        <Modal title="Add Linen Type" onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit}>
            <div><label className="label">{t('inventory.nameRequired')}</label><input className="input w-full" required value={form.linen_name} onChange={e => setForm({...form, linen_name: e.target.value})} placeholder={t("inventory.linenNameExample")} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('inventory.category')}</label><select className="input w-full" value={form.category} onChange={e => setForm({...form, category: e.target.value})}><option value="general">{t('inventory.general')}</option><option value="ot">{t('inventory.ot')}</option><option value="icu">{t('inventory.icu')}</option><option value="pediatric">{t('inventory.pediatric')}</option><option value="maternity">{t('inventory.maternity')}</option></select></div>
              <div><label className="label">{t('inventory.parLevel')}</label><input className="input w-full" type="number" value={form.par_level} onChange={e => setForm({...form, par_level: e.target.value})} /></div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Add'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export default function LaundryManagement({ role }: { role?: string }) {
  const { t } = useTranslation('inventory');
  const [tab, setTab] = useState<Tab>('collections');
  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
              <Shirt className="w-5 h-5 text-white" />
            </div>
            <div><h1 className="page-title">Laundry</h1><p className="section-subtitle">Linen collection, wash tracking & ward delivery</p></div>
          </div>
        </div>
        <div className="card p-1.5 flex gap-1">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>
              {t === 'collections' ? 'Collections' : 'Linen Types'}
            </button>
          ))}
        </div>
        {tab === 'collections' ? <CollectionsTab /> : <LinenTypesTab />}
      </div>
    </DashboardLayout>
  );
}
