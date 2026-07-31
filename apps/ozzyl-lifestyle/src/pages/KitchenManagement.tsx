import { useState, useEffect, useCallback } from 'react';
import {
  UtensilsCrossed, Plus, X, RefreshCw, ChefHat, Truck, Clock,
  CheckCircle, AlertTriangle, Search, Filter,
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { authHeader } from '../utils/auth';
import { useTranslation } from 'react-i18next';

/* ─── Types ───────────────────────────────────────────────── */
interface MealOrder {
  id: number; patient_name?: string; patient_code?: string; ward_name?: string;
  bed_number?: string; diet_type_name?: string; meal_name: string;
  order_date: string; special_instructions?: string; status: string;
  prepared_at?: string; delivered_at?: string;
}
interface DietType { id: number; diet_name: string; description?: string; calories_range?: string; restrictions?: string; }
interface MealSchedule { id: number; meal_name: string; start_time: string; end_time: string; sort_order?: number; }
interface Stats {
  total_orders: number; pending: number; preparing: number;
  ready: number; delivered: number; cancelled: number;
}
interface WardRow { ward_name: string; meal_name: string; total: number; delivered: number; pending: number; }

/* ─── Constants ───────────────────────────────────────────── */
const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600', preparing: 'bg-amber-100 text-amber-700',
  ready: 'bg-blue-100 text-blue-700', delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600', returned: 'bg-orange-100 text-orange-700',
};
const TABS = ['orders', 'ward-view', 'diet-types', 'schedules'] as const;
type Tab = typeof TABS[number];

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

/* ─── Orders Tab ──────────────────────────────────────────── */
function OrdersTab() {
  const { t } = useTranslation('kitchen');
  const [orders, setOrders] = useState<MealOrder[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [mealFilter, setMealFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);
  const [genMeal, setGenMeal] = useState('Breakfast');
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { date };
      if (mealFilter) params.meal = mealFilter;
      if (statusFilter) params.status = statusFilter;
      const [oRes, sRes] = await Promise.all([
        axios.get('/api/kitchen/orders', { params, headers: authHeader() }),
        axios.get('/api/kitchen/stats', { params: { date }, headers: authHeader() }),
      ]);
      setOrders(oRes.data?.data ?? []);
      setStats(sRes.data?.stats ?? null);
    } catch { setOrders([]); }
    finally { setLoading(false); }
  }, [date, mealFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id: number, status: string) => {
    try {
      await axios.put(`/api/kitchen/orders/${id}/status`, { status }, { headers: authHeader() });
      toast.success(t('orderStatusUpdated', { status }));
      load();
    } catch { toast.error(t('failed')); }
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const { data } = await axios.post('/api/kitchen/orders/generate', { order_date: date, meal_name: genMeal }, { headers: authHeader() });
      toast.success(t('ordersGenerated', { count: data.generated }));
      setShowGenerate(false); load();
    } catch { toast.error(t('failed')); }
    finally { setGenerating(false); }
  };

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {[
            { label: t('total'), val: stats.total_orders, color: '' },
            { label: t('pending'), val: stats.pending, color: 'text-gray-600' },
            { label: t('preparing'), val: stats.preparing, color: 'text-amber-600' },
            { label: t('ready'), val: stats.ready, color: 'text-blue-600' },
            { label: t('delivered'), val: stats.delivered, color: 'text-green-600' },
            { label: t('cancelled'), val: stats.cancelled, color: 'text-red-500' },
          ].map(k => (
            <div key={k.label} className="card p-3 text-center">
              <p className="text-xs text-[var(--color-text-muted)] uppercase">{k.label}</p>
              <p className={`text-xl font-bold mt-1 ${k.color}`}>{k.val}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-end">
        <div><label className="label">{t('date')}</label><input type="date" className="input w-40" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div>
          <label className="label">{t('meal')}</label>
          <select className="input w-36" value={mealFilter} onChange={e => setMealFilter(e.target.value)}>
            <option value="">{t('allMeals')}</option>
            <option value="Breakfast">{t('breakfast')}</option>
            <option value="Lunch">{t('lunch')}</option>
            <option value="Snack">{t('snack')}</option>
            <option value="Dinner">{t('dinner')}</option>
          </select>
        </div>
        <div>
          <label className="label">{t('status')}</label>
          <select className="input w-36" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">{t('all')}</option>
            <option value="pending">{t('pending')}</option>
            <option value="preparing">{t('preparing')}</option>
            <option value="ready">{t('ready')}</option>
            <option value="delivered">{t('delivered')}</option>
          </select>
        </div>
        <div className="flex-1" />
        <button onClick={() => setShowGenerate(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('generateOrders')}</button>
        <button onClick={load} className="btn-ghost"><RefreshCw className="w-4 h-4" /></button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr>
              <th>{t('patient')}</th><th>{t('wardBed')}</th><th>{t('diet')}</th><th>{t('mealName')}</th>
              <th>{t('instructions')}</th><th>{t('status')}</th><th>{t('actions')}</th>
            </tr></thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              ) : orders.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-[var(--color-text-muted)]">{t('noMealOrders')}</td></tr>
              ) : orders.map(o => (
                <tr key={o.id}>
                  <td><span className="font-medium">{o.patient_name ?? '—'}</span><br /><span className="text-xs text-[var(--color-text-muted)]">{o.patient_code}</span></td>
                  <td className="text-sm">{o.ward_name ?? '—'}{o.bed_number ? ` / ${o.bed_number}` : ''}</td>
                  <td><span className="badge-neutral text-xs">{o.diet_type_name ?? 'Normal'}</span></td>
                  <td className="text-sm font-medium">{o.meal_name}</td>
                  <td className="text-xs text-[var(--color-text-muted)] max-w-32 truncate">{o.special_instructions ?? '—'}</td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[o.status] ?? 'badge-neutral'}`}>{o.status}</span></td>
                  <td>
                    <div className="flex gap-1">
                      {o.status === 'pending' && <button onClick={() => updateStatus(o.id, 'preparing')} className="btn-ghost text-xs p-1" title={t('preparing')}><ChefHat className="w-3.5 h-3.5" /></button>}
                      {o.status === 'preparing' && <button onClick={() => updateStatus(o.id, 'ready')} className="btn-ghost text-xs p-1 text-blue-600" title={t('ready')}><CheckCircle className="w-3.5 h-3.5" /></button>}
                      {o.status === 'ready' && <button onClick={() => updateStatus(o.id, 'delivered')} className="btn-ghost text-xs p-1 text-green-600" title={t('delivered')}><Truck className="w-3.5 h-3.5" /></button>}
                      {o.status !== 'delivered' && o.status !== 'cancelled' && <button onClick={() => updateStatus(o.id, 'cancelled')} className="btn-ghost text-xs p-1 text-red-400" title={t('cancelled')}><X className="w-3.5 h-3.5" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showGenerate && (
        <Modal title={t('generateMealOrders')} onClose={() => setShowGenerate(false)}>
          <p className="text-sm text-[var(--color-text-muted)]">{t('generateDesc')}</p>
          <div><label className="label">{t('date')}</label><input type="date" className="input w-full" value={date} readOnly /></div>
          <div><label className="label">{t('meal')}</label>
            <select className="input w-full" value={genMeal} onChange={e => setGenMeal(e.target.value)}>
              <option>{t('breakfast')}</option><option>{t('lunch')}</option><option>{t('snack')}</option><option>{t('dinner')}</option>
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowGenerate(false)} className="btn-secondary">{t('cancel')}</button>
            <button onClick={generate} disabled={generating} className="btn-primary">{generating ? t('generating') : t('generate')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ─── Ward View Tab ───────────────────────────────────────── */
function WardViewTab() {
  const { t } = useTranslation('kitchen');
  const [rows, setRows] = useState<WardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/kitchen/ward-summary', { params: { date }, headers: authHeader() });
      setRows(data?.data ?? []);
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end">
        <div><label className="label">{t('date')}</label><input type="date" className="input w-40" value={date} onChange={e => setDate(e.target.value)} /></div>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>{t('ward')}</th><th>{t('mealName2')}</th><th>{t('total')}</th><th>{t('deliveredCount')}</th><th>{t('pendingCount')}</th><th>{t('progress')}</th></tr></thead>
            <tbody>
              {loading ? (
                [...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">{t('noData')}</td></tr>
              ) : rows.map((r, i) => {
                const pct = r.total > 0 ? Math.round((r.delivered / r.total) * 100) : 0;
                return (
                  <tr key={i}>
                    <td className="font-medium">{r.ward_name ?? 'Unknown'}</td>
                    <td>{r.meal_name}</td>
                    <td className="font-data">{r.total}</td>
                    <td className="font-data text-green-600">{r.delivered}</td>
                    <td className="font-data text-amber-600">{r.pending}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-2"><div className="bg-green-500 h-2 rounded-full" style={{ width: `${pct}%` }} /></div>
                        <span className="text-xs font-medium w-10 text-right">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Diet Types Tab ──────────────────────────────────────── */
function DietTypesTab() {
  const { t } = useTranslation('kitchen');
  const [items, setItems] = useState<DietType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ diet_name: '', description: '', calories_range: '', restrictions: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await axios.get('/api/kitchen/diet-types', { headers: authHeader() }); setItems(data?.data ?? []); }
    catch { setItems([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/kitchen/diet-types', form, { headers: authHeader() });
      toast.success(t('dietTypeAdded')); setShowForm(false); setForm({ diet_name: '', description: '', calories_range: '', restrictions: '' }); load();
    } catch { toast.error(t('failed')); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('addDietType')}</button></div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>{t('dietName')}</th><th>{t('description')}</th><th>{t('calories')}</th><th>{t('restrictions')}</th><th></th></tr></thead>
            <tbody>
              {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(5)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : items.length === 0 ? <tr><td colSpan={5} className="text-center py-8 text-[var(--color-text-muted)]">{t('noDietTypes')}</td></tr>
              : items.map(d => (
                <tr key={d.id}>
                  <td className="font-medium">{d.diet_name}</td>
                  <td className="text-sm text-[var(--color-text-muted)]">{d.description ?? '—'}</td>
                  <td className="text-sm">{d.calories_range ?? '—'}</td>
                  <td className="text-sm text-[var(--color-text-muted)] max-w-48 truncate">{d.restrictions ?? '—'}</td>
                  <td><button onClick={async () => { await axios.delete(`/api/kitchen/diet-types/${d.id}`, { headers: authHeader() }); load(); }} className="btn-ghost text-xs text-red-400 p-1"><X className="w-3.5 h-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showForm && (
        <Modal title={t('addDietTypeTitle')} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit}>
            <div><label className="label">{t('dietName')} *</label><input className="input w-full" required value={form.diet_name} onChange={e => setForm({...form, diet_name: e.target.value})} placeholder={t('dietNamePlaceholder')} /></div>
            <div><label className="label">{t('description')}</label><input className="input w-full" value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></div>
            <div><label className="label">{t('calories')}</label><input className="input w-full" value={form.calories_range} onChange={e => setForm({...form, calories_range: e.target.value})} placeholder={t('caloriesPlaceholder')} /></div>
            <div><label className="label">{t('restrictions')}</label><textarea className="input w-full" rows={2} value={form.restrictions} onChange={e => setForm({...form, restrictions: e.target.value})} placeholder={t('restrictionsPlaceholder')} /></div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('saving') : t('add')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ─── Schedules Tab ───────────────────────────────────────── */
function SchedulesTab() {
  const { t } = useTranslation('kitchen');
  const [items, setItems] = useState<MealSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ meal_name: '', start_time: '', end_time: '', sort_order: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await axios.get('/api/kitchen/meal-schedules', { headers: authHeader() }); setItems(data?.data ?? []); }
    catch { setItems([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/kitchen/meal-schedules', form, { headers: authHeader() });
      toast.success(t('scheduleAdded')); setShowForm(false); load();
    } catch { toast.error(t('failed')); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('addSchedule')}</button></div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>{t('mealNameLabel')}</th><th>{t('startTime')}</th><th>{t('endTime')}</th><th>{t('order')}</th></tr></thead>
            <tbody>
              {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(4)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : items.length === 0 ? <tr><td colSpan={4} className="text-center py-8 text-[var(--color-text-muted)]">{t('noSchedules')}</td></tr>
              : items.map(s => (
                <tr key={s.id}>
                  <td className="font-medium">{s.meal_name}</td>
                  <td className="font-data">{s.start_time}</td>
                  <td className="font-data">{s.end_time}</td>
                  <td className="text-sm text-[var(--color-text-muted)]">{s.sort_order}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showForm && (
        <Modal title={t('addScheduleTitle')} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit}>
            <div><label className="label">{t('mealNameLabel')}</label><input className="input w-full" required value={form.meal_name} onChange={e => setForm({...form, meal_name: e.target.value})} placeholder={t('mealNamePlaceholder')} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('startTime')} *</label><input type="time" className="input w-full" required value={form.start_time} onChange={e => setForm({...form, start_time: e.target.value})} /></div>
              <div><label className="label">{t('endTime')} *</label><input type="time" className="input w-full" required value={form.end_time} onChange={e => setForm({...form, end_time: e.target.value})} /></div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('saving') : t('add')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ─── Tab Map ─────────────────────────────────────────────── */
const TAB_INFO: Record<Tab, { labelKey: string; icon: typeof UtensilsCrossed }> = {
  orders: { labelKey: 'mealOrders', icon: UtensilsCrossed },
  'ward-view': { labelKey: 'wardView', icon: Filter },
  'diet-types': { labelKey: 'dietTypes', icon: ChefHat },
  schedules: { labelKey: 'schedules', icon: Clock },
};
const TAB_COMPONENT: Record<Tab, React.ComponentType> = {
  orders: OrdersTab, 'ward-view': WardViewTab, 'diet-types': DietTypesTab, schedules: SchedulesTab,
};

/* ─── Main Page ───────────────────────────────────────────── */
export default function KitchenManagement({ role }: { role?: string }) {
  const { t } = useTranslation('kitchen');
  const [tab, setTab] = useState<Tab>('orders');
  const Content = TAB_COMPONENT[tab];

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <UtensilsCrossed className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('title')}</h1>
              <p className="section-subtitle">{t('subtitle')}</p>
            </div>
          </div>
        </div>

        <div className="card p-1.5 flex gap-1 flex-wrap">
          {TABS.map(tKey => {
            const info = TAB_INFO[tKey];
            const Icon = info.icon;
            return (
              <button key={tKey} onClick={() => setTab(tKey)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === tKey ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'
                }`}>
                <Icon className="w-4 h-4" />{t(info.labelKey)}
              </button>
            );
          })}
        </div>

        <Content />
      </div>
    </DashboardLayout>
  );
}
