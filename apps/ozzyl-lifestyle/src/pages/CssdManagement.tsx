import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Shield, Plus, X, RefreshCw, CheckCircle, AlertTriangle,
  Package, Clock, Truck, FlaskConical, Thermometer,
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { authHeader } from '../utils/auth';

interface InstrumentSet { id: number; set_name: string; set_code?: string; department?: string; item_count: number; description?: string; }
interface Cycle { id: number; cycle_number: string; autoclave_id?: string; cycle_type: string; temperature_celsius?: number; duration_minutes?: number; start_time: string; end_time?: string; biological_indicator: string; chemical_indicator: string; status: string; operator_name?: string; }
interface CycleItem { id: number; set_name: string; set_code?: string; pack_number?: string; status: string; expiry_date?: string; issued_to?: string; used: number; cycle_number: string; sterilized_at?: string; }
interface Collection { id: number; set_name?: string; received_from: string; received_at: string; condition: string; item_count?: number; remarks?: string; }
interface Stats { total_sets: number; today_cycles: number; sterile_ready: number; failed_today: number; pending_collection: number; }

const STATUS_BADGE: Record<string, string> = { in_progress: 'bg-blue-100 text-blue-700', completed: 'badge-success', failed: 'bg-red-100 text-red-700', cancelled: 'badge-neutral' };
const IND_BADGE: Record<string, string> = { pending: 'badge-neutral', pass: 'badge-success', fail: 'bg-red-100 text-red-700', not_applicable: 'bg-gray-100 text-gray-500' };
const TABS = ['inventory', 'cycles', 'sets', 'collections'] as const;
type Tab = typeof TABS[number];

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useTranslation('inventory');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]"><h3 className="font-semibold">{title}</h3><button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button></div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function InventoryTab() {
  const [items, setItems] = useState<CycleItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [iRes, sRes] = await Promise.all([axios.get('/api/cssd/inventory', { headers: authHeader() }), axios.get('/api/cssd/stats', { headers: authHeader() })]);
      setItems(iRes.data?.data ?? []); setStats(sRes.data ?? null);
    } catch { setItems([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const issue = async (id: number) => {
    const dept = prompt('Issue to which department?');
    if (!dept) return;
    try { await axios.put(`/api/cssd/items/${id}/issue`, { issued_to: dept }, { headers: authHeader() }); toast.success(t('inventory.issued')); load(); } catch { toast.error(t('inventory.failed')); }
  };
  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { l: 'Instrument Sets', v: stats.total_sets, c: '' },
            { l: "Today's Cycles", v: stats.today_cycles, c: 'text-blue-600' },
            { l: 'Sterile Ready', v: stats.sterile_ready, c: 'text-green-600' },
            { l: 'Failed Today', v: stats.failed_today, c: 'text-red-500' },
            { l: 'Collections', v: stats.pending_collection, c: 'text-amber-600' },
          ].map(k => <div key={k.l} className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)]">{k.l}</p><p className={`text-2xl font-bold mt-1 ${k.c}`}>{k.v}</p></div>)}
        </div>
      )}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-[var(--color-border)]"><h3 className="font-semibold">Sterile Inventory (Available Packs)</h3></div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Set</th><th>Code</th><th>Cycle #</th><th>Sterilized</th><th>Expiry</th><th>Issued To</th><th></th></tr></thead>
            <tbody>
              {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : items.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-[var(--color-text-muted)]">No sterile packs available</td></tr>
              : items.map(it => (
                <tr key={it.id}>
                  <td className="font-medium">{it.set_name}</td>
                  <td className="font-mono text-xs">{it.set_code ?? '—'}</td>
                  <td className="text-xs">{it.cycle_number}</td>
                  <td className="text-xs">{it.sterilized_at?.slice(0, 10)}</td>
                  <td className="text-xs">{it.expiry_date ?? '—'}</td>
                  <td className="text-sm">{it.issued_to ?? <span className="text-green-600 text-xs font-medium">In Stock</span>}</td>
                  <td>{!it.issued_to && <button onClick={() => issue(it.id)} className="btn-ghost text-xs p-1"><Truck className="w-3.5 h-3.5" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CyclesTab() {
  const [items, setItems] = useState<Cycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sets, setSets] = useState<InstrumentSet[]>([]);
  const [form, setForm] = useState({ autoclave_id: '', cycle_type: 'gravity', temperature_celsius: '134', pressure_psi: '30', duration_minutes: '30', start_time: new Date().toISOString().slice(0, 16), operator_name: '', instrument_set_ids: [] as number[], remarks: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, sRes] = await Promise.all([axios.get('/api/cssd/cycles', { headers: authHeader() }), axios.get('/api/cssd/sets', { headers: authHeader() })]);
      setItems(cRes.data?.data ?? []); setSets(sRes.data?.data ?? []);
    } catch { setItems([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); if (form.instrument_set_ids.length === 0) { toast.error(t('inventory.select_at_least_one_instrument_set')); return; }
    setSaving(true);
    try {
      await axios.post('/api/cssd/cycles', { ...form, temperature_celsius: Number(form.temperature_celsius) || undefined, pressure_psi: Number(form.pressure_psi) || undefined, duration_minutes: Number(form.duration_minutes) || undefined }, { headers: authHeader() });
      toast.success(t('inventory.cycle_started')); setShowForm(false); load();
    } catch { toast.error(t('inventory.failed')); } finally { setSaving(false); }
  };

  const complete = async (id: number, status: 'completed' | 'failed') => {
    const bio = status === 'completed' ? 'pass' : 'fail';
    try { await axios.put(`/api/cssd/cycles/${id}/complete`, { status, biological_indicator: bio, chemical_indicator: bio, failure_reason: status === 'failed' ? 'Indicator failed' : undefined }, { headers: authHeader() }); toast.success(`Cycle ${status}`); load(); } catch { toast.error(t('inventory.failed')); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> New Cycle</button></div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Cycle #</th><th>Type</th><th>Temp/Pressure</th><th>Duration</th><th>Bio Ind</th><th>Chem Ind</th><th>Status</th><th>Started</th><th></th></tr></thead>
            <tbody>
              {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(9)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : items.length === 0 ? <tr><td colSpan={9} className="text-center py-8 text-[var(--color-text-muted)]">No cycles</td></tr>
              : items.map(c => (
                <tr key={c.id}>
                  <td className="font-mono text-sm font-bold text-[var(--color-primary)]">{c.cycle_number}</td>
                  <td className="text-xs badge-neutral">{c.cycle_type}</td>
                  <td className="text-xs font-data">{c.temperature_celsius ? `${c.temperature_celsius}°C` : '—'} / {c.duration_minutes ? `${c.duration_minutes}min` : '—'}</td>
                  <td className="text-xs">{c.duration_minutes ? `${c.duration_minutes} min` : '—'}</td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${IND_BADGE[c.biological_indicator] ?? ''}`}>{c.biological_indicator}</span></td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${IND_BADGE[c.chemical_indicator] ?? ''}`}>{c.chemical_indicator}</span></td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[c.status] ?? 'badge-neutral'}`}>{c.status}</span></td>
                  <td className="text-xs">{c.start_time?.slice(0, 16).replace('T', ' ')}</td>
                  <td>
                    {c.status === 'in_progress' && (
                      <div className="flex gap-1">
                        <button onClick={() => complete(c.id, 'completed')} className="btn-ghost text-xs p-1 text-green-600" title="Pass"><CheckCircle className="w-3.5 h-3.5" /></button>
                        <button onClick={() => complete(c.id, 'failed')} className="btn-ghost text-xs p-1 text-red-500" title="Fail"><AlertTriangle className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showForm && (
        <Modal title="Start Sterilization Cycle" onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Autoclave</label><input className="input w-full" value={form.autoclave_id} onChange={e => setForm({...form, autoclave_id: e.target.value})} placeholder={t("common.eg_ac01")} /></div>
              <div><label className="label">{t('common.type')}</label>
                <select className="input w-full" value={form.cycle_type} onChange={e => setForm({...form, cycle_type: e.target.value})}>
                  <option value="gravity">Gravity</option><option value="prevacuum">Pre-vacuum</option>
                  <option value="flash">Flash</option><option value="eto">ETO</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="label">{t('common.temp_c')}</label><input className="input w-full" type="number" value={form.temperature_celsius} onChange={e => setForm({...form, temperature_celsius: e.target.value})} /></div>
              <div><label className="label">{t('common.pressure_psi')}</label><input className="input w-full" type="number" value={form.pressure_psi} onChange={e => setForm({...form, pressure_psi: e.target.value})} /></div>
              <div><label className="label">{t('common.duration_min')}</label><input className="input w-full" type="number" value={form.duration_minutes} onChange={e => setForm({...form, duration_minutes: e.target.value})} /></div>
            </div>
            <div><label className="label">{t('common.instrument_sets_')}</label>
              <div className="space-y-1 max-h-40 overflow-y-auto border border-[var(--color-border)] rounded-lg p-2">
                {sets.map(s => (
                  <label key={s.id} className="flex items-center gap-2 text-sm py-1">
                    <input type="checkbox" checked={form.instrument_set_ids.includes(s.id)} onChange={e => {
                      setForm(f => ({ ...f, instrument_set_ids: e.target.checked ? [...f.instrument_set_ids, s.id] : f.instrument_set_ids.filter(x => x !== s.id) }));
                    }} />
                    {s.set_name} {s.set_code && <span className="text-xs text-[var(--color-text-muted)]">({s.set_code})</span>}
                  </label>
                ))}
                {sets.length === 0 && <p className="text-xs text-[var(--color-text-muted)]">No sets defined. Add sets first.</p>}
              </div>
            </div>
            <div><label className="label">{t('common.operator')}</label><input className="input w-full" value={form.operator_name} onChange={e => setForm({...form, operator_name: e.target.value})} /></div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Starting...' : 'Start Cycle'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function SetsTab() {
  const [items, setItems] = useState<InstrumentSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ set_name: '', set_code: '', department: '', item_count: '', description: '' });
  const load = useCallback(async () => { setLoading(true); try { const { data } = await axios.get('/api/cssd/sets', { headers: authHeader() }); setItems(data?.data ?? []); } catch { setItems([]); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);
  const handleSubmit = async (e: React.FormEvent) => { e.preventDefault(); setSaving(true); try { await axios.post('/api/cssd/sets', { ...form, item_count: Number(form.item_count) || 0 }, { headers: authHeader() }); toast.success('Set created'); setShowForm(false); load(); } catch { toast.error('Failed'); } finally { setSaving(false); } };
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> Add Set</button></div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Set Name</th><th>Code</th><th>Department</th><th>Items</th><th>Description</th></tr></thead>
            <tbody>
              {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(5)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : items.length === 0 ? <tr><td colSpan={5} className="text-center py-8 text-[var(--color-text-muted)]">No sets</td></tr>
              : items.map(s => (
                <tr key={s.id}>
                  <td className="font-medium">{s.set_name}</td>
                  <td className="font-mono text-xs">{s.set_code ?? '—'}</td>
                  <td className="text-sm">{s.department ?? '—'}</td>
                  <td className="font-data text-center">{s.item_count}</td>
                  <td className="text-xs text-[var(--color-text-muted)] max-w-48 truncate">{s.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showForm && (
        <Modal title="Add Instrument Set" onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit}>
            <div><label className="label">Set Name *</label><input className="input w-full" required value={form.set_name} onChange={e => setForm({...form, set_name: e.target.value})} placeholder={t("common.eg_general_surgery_set")} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('common.code')}</label><input className="input w-full" value={form.set_code} onChange={e => setForm({...form, set_code: e.target.value})} /></div>
              <div><label className="label">{t('common.item_count')}</label><input className="input w-full" type="number" value={form.item_count} onChange={e => setForm({...form, item_count: e.target.value})} /></div>
            </div>
            <div><label className="label">Department</label><input className="input w-full" value={form.department} onChange={e => setForm({...form, department: e.target.value})} placeholder={t("common.ot_labor_room")} /></div>
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

function CollectionsTab() {
  const [items, setItems] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ received_from: '', condition: 'dirty', item_count: '', remarks: '' });
  const load = useCallback(async () => { setLoading(true); try { const { data } = await axios.get('/api/cssd/collections', { headers: authHeader() }); setItems(data?.data ?? []); } catch { setItems([]); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);
  const handleSubmit = async (e: React.FormEvent) => { e.preventDefault(); setSaving(true); try { await axios.post('/api/cssd/collections', { ...form, item_count: Number(form.item_count) || undefined }, { headers: authHeader() }); toast.success('Collection logged'); setShowForm(false); load(); } catch { toast.error('Failed'); } finally { setSaving(false); } };
  const COND_BADGE: Record<string, string> = { dirty: 'badge-warning', contaminated: 'bg-red-100 text-red-700', damaged: 'bg-orange-100 text-orange-700' };
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> Log Collection</button></div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Set</th><th>From</th><th>Condition</th><th>Items</th><th>Received At</th><th>Remarks</th></tr></thead>
            <tbody>
              {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : items.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">No collections</td></tr>
              : items.map(c => (
                <tr key={c.id}>
                  <td className="font-medium">{c.set_name ?? '—'}</td>
                  <td>{c.received_from}</td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${COND_BADGE[c.condition] ?? ''}`}>{c.condition}</span></td>
                  <td className="font-data text-center">{c.item_count ?? '—'}</td>
                  <td className="text-xs">{c.received_at?.slice(0, 16).replace('T', ' ')}</td>
                  <td className="text-xs text-[var(--color-text-muted)]">{c.remarks ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showForm && (
        <Modal title="Log Dirty Collection" onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit}>
            <div><label className="label">Received From *</label><input className="input w-full" required value={form.received_from} onChange={e => setForm({...form, received_from: e.target.value})} placeholder={t("common.ot_1_ward_b")} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('common.condition')}</label><select className="input w-full" value={form.condition} onChange={e => setForm({...form, condition: e.target.value})}><option value="dirty">Dirty</option><option value="contaminated">Contaminated</option><option value="damaged">Damaged</option></select></div>
              <div><label className="label">{t('common.item_count')}</label><input className="input w-full" type="number" value={form.item_count} onChange={e => setForm({...form, item_count: e.target.value})} /></div>
            </div>
            <div><label className="label">{t('common.remarks')}</label><textarea className="input w-full" rows={2} value={form.remarks} onChange={e => setForm({...form, remarks: e.target.value})} /></div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Log'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

const TAB_INFO: Record<Tab, { label: string; icon: typeof Shield }> = {
  inventory: { label: 'Sterile Inventory', icon: Package },
  cycles: { label: 'Sterilization Cycles', icon: Thermometer },
  sets: { label: 'Instrument Sets', icon: FlaskConical },
  collections: { label: 'Collections', icon: Clock },
};
const TAB_COMP: Record<Tab, React.ComponentType> = { inventory: InventoryTab, cycles: CyclesTab, sets: SetsTab, collections: CollectionsTab };

export default function CssdManagement({ role }: { role?: string }) {
  const [tab, setTab] = useState<Tab>('inventory');
  const Content = TAB_COMP[tab];
  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div><h1 className="page-title">CSSD</h1><p className="section-subtitle">Central Sterile Supply — sterilization cycles, inventory & collection</p></div>
          </div>
        </div>
        <div className="card p-1.5 flex gap-1 flex-wrap">
          {TABS.map(t => { const info = TAB_INFO[t]; const Icon = info.icon; return (
            <button key={t} onClick={() => setTab(t)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}><Icon className="w-4 h-4" />{info.label}</button>
          ); })}
        </div>
        <Content />
      </div>
    </DashboardLayout>
  );
}
