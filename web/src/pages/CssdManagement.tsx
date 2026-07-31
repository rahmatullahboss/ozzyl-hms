import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Shield, Plus, X, CheckCircle, AlertTriangle,
  Package, Clock, Truck, FlaskConical, Thermometer,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';

interface InstrumentSet { id: number; set_name: string; set_code?: string; department?: string; item_count: number; description?: string; }
interface Cycle { id: number; cycle_number: string; autoclave_id?: string; cycle_type: string; temperature_celsius?: number; duration_minutes?: number; start_time: string; end_time?: string; biological_indicator: string; chemical_indicator: string; status: string; operator_name?: string; }
interface CycleItem { id: number; set_name: string; set_code?: string; pack_number?: string; status: string; expiry_date?: string; issued_to?: string; used: number; cycle_number: string; sterilized_at?: string; }
interface Collection { id: number; set_name?: string; received_from: string; received_at: string; condition: string; item_count?: number; remarks?: string; }
interface Stats { total_sets: number; today_cycles: number; sterile_ready: number; failed_today: number; pending_collection: number; }

interface ListResponse<T> { data: T[]; }

const STATUS_BADGE: Record<string, string> = { in_progress: 'bg-blue-100 text-blue-700', completed: 'badge-success', failed: 'bg-red-100 text-red-700', cancelled: 'badge-neutral' };
const IND_BADGE: Record<string, string> = { pending: 'badge-neutral', pass: 'badge-success', fail: 'bg-red-100 text-red-700', na: 'bg-gray-100 text-gray-500' };
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
  const { t, i18n } = useTranslation('inventory');
  const queryClient = useQueryClient();

  const { data: inventoryData, isLoading: loadingItems } = useApiQuery<ListResponse<CycleItem>>(
    queryKeys.cssd.inventory(),
    '/api/cssd/inventory',
  );
  const { data: stats } = useApiQuery<Stats>(
    queryKeys.cssd.stats(),
    '/api/cssd/stats',
  );

  const items = inventoryData?.data ?? [];
  const loading = loadingItems;

  const issueMutation = useApiMutation<unknown, { id: number; issued_to: string }>(
    'put',
    (vars) => `/api/cssd/items/${vars.id}/issue`,
    {
      onSuccess: () => {
        toast.success(t('cssd.issued'));
        queryClient.invalidateQueries({ queryKey: queryKeys.cssd.all });
      },
      onError: () => {
        toast.error(t('cssd.failed'));
      },
    },
  );

  const issue = (id: number) => {
    const dept = prompt(t('cssd.issuePrompt'));
    if (!dept) return;
    issueMutation.mutate({ id, issued_to: dept });
  };

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { l: t('cssd.totalSets'), v: stats.total_sets.toLocaleString(i18n.language), c: '' },
            { l: t('cssd.todayCycles'), v: stats.today_cycles.toLocaleString(i18n.language), c: 'text-blue-600' },
            { l: t('cssd.sterileReady'), v: stats.sterile_ready.toLocaleString(i18n.language), c: 'text-green-600' },
            { l: t('cssd.failedToday'), v: stats.failed_today.toLocaleString(i18n.language), c: 'text-red-500' },
            { l: t('cssd.pendingCollections'), v: stats.pending_collection.toLocaleString(i18n.language), c: 'text-amber-600' },
          ].map(k => <div key={k.l} className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)]">{k.l}</p><p className={`text-2xl font-bold mt-1 ${k.c}`}>{k.v}</p></div>)}
        </div>
      )}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-[var(--color-border)]"><h3 className="font-semibold">{t('cssd.inventoryHeading')}</h3></div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>{t('cssd.setName')}</th><th>{t('cssd.code')}</th><th>{t('cycles.cycleNo')}</th><th>{t('cssd.started')}</th><th>{t('inventory.expiry')}</th><th>{t('cssd.dept')}</th><th></th></tr></thead>
            <tbody>
              {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : items.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-[var(--color-text-muted)]">{t('cssd.noInventory')}</td></tr>
              : items.map(it => (
                <tr key={it.id}>
                  <td className="font-medium">{it.set_name}</td>
                  <td className="font-mono text-xs">{it.set_code ?? '—'}</td>
                  <td className="text-xs">{it.cycle_number}</td>
                  <td className="text-xs">{it.sterilized_at ? new Date(it.sterilized_at).toLocaleDateString(i18n.language) : '—'}</td>
                  <td className="text-xs">{it.expiry_date ? new Date(it.expiry_date).toLocaleDateString(i18n.language) : '—'}</td>
                  <td className="text-sm">{it.issued_to ?? <span className="text-green-600 text-xs font-medium">{t('cssd.inStock')}</span>}</td>
                  <td>{!it.issued_to && <button onClick={() => issue(it.id)} className="btn-ghost text-xs p-1" title={t('cssd.issuePrompt')}><Truck className="w-3.5 h-3.5" /></button>}</td>
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
  const { t, i18n } = useTranslation('inventory');
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ autoclave_id: '', cycle_type: 'gravity', temperature_celsius: '134', pressure_psi: '30', duration_minutes: '30', start_time: new Date().toISOString().slice(0, 16), operator_name: '', instrument_set_ids: [] as number[], remarks: '' });

  const { data: cyclesData, isLoading: loadingCycles } = useApiQuery<ListResponse<Cycle>>(
    queryKeys.cssd.cycles(),
    '/api/cssd/cycles',
  );
  const { data: setsData } = useApiQuery<ListResponse<InstrumentSet>>(
    queryKeys.cssd.sets(),
    '/api/cssd/sets',
  );

  const items = cyclesData?.data ?? [];
  const sets = setsData?.data ?? [];
  const loading = loadingCycles;

  const createCycleMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/cssd/cycles',
    {
      onSuccess: () => {
        toast.success(t('cssd.cycleStarted'));
        setShowForm(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.cssd.all });
      },
      onError: () => {
        toast.error(t('cssd.failed'));
      },
    },
  );

  const completeCycleMutation = useApiMutation<unknown, { id: number; status: string; biological_indicator: string; chemical_indicator: string; failure_reason?: string }>(
    'put',
    (vars) => `/api/cssd/cycles/${vars.id}/complete`,
    {
      onSuccess: (_data, vars) => {
        toast.success(`${t('common.cycle')} ${t(`cssd.statuses.${vars.status}`)}`);
        queryClient.invalidateQueries({ queryKey: queryKeys.cssd.all });
      },
      onError: () => {
        toast.error(t('cssd.failed'));
      },
    },
  );

  const saving = createCycleMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.instrument_set_ids.length === 0) { toast.error(t('cssd.selectSet')); return; }
    createCycleMutation.mutate({
      ...form,
      temperature_celsius: Number(form.temperature_celsius) || undefined,
      pressure_psi: Number(form.pressure_psi) || undefined,
      duration_minutes: Number(form.duration_minutes) || undefined,
    });
  };

  const complete = (id: number, status: 'completed' | 'failed') => {
    const bio = status === 'completed' ? 'pass' : 'fail';
    completeCycleMutation.mutate({
      id,
      status,
      biological_indicator: bio,
      chemical_indicator: bio,
      failure_reason: status === 'failed' ? 'Indicator failed' : undefined,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('cssd.newCycle')}</button></div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>{t('cycles.cycleNo')}</th><th>{t('cssd.type')}</th><th>{t('cssd.tempPressure')}</th><th>{t('cssd.duration')}</th><th>{t('cssd.bioInd')}</th><th>{t('cssd.chemInd')}</th><th>{t('inventory.status')}</th><th>{t('cssd.started')}</th><th></th></tr></thead>
            <tbody>
              {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(9)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : items.length === 0 ? <tr><td colSpan={9} className="text-center py-8 text-[var(--color-text-muted)]">{t('cssd.noCycles')}</td></tr>
              : items.map(c => (
                <tr key={c.id}>
                  <td className="font-mono text-sm font-bold text-[var(--color-primary)]">{c.cycle_number}</td>
                  <td className="text-xs badge-neutral">{t(`cssd.cycleTypes.${c.cycle_type}`)}</td>
                  <td className="text-xs font-data">
                    {c.temperature_celsius ? `${c.temperature_celsius.toLocaleString(i18n.language)}${t('cssd.units.celsius')}` : '—'} / {c.duration_minutes ? `${c.duration_minutes.toLocaleString(i18n.language)}${t('cssd.units.min')}` : '—'}
                  </td>
                  <td className="text-xs">{c.duration_minutes ? `${c.duration_minutes.toLocaleString(i18n.language)} ${t('cssd.units.min')}` : '—'}</td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${IND_BADGE[c.biological_indicator] ?? ''}`}>{t(`cssd.indicators.${c.biological_indicator}`)}</span></td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${IND_BADGE[c.chemical_indicator] ?? ''}`}>{t(`cssd.indicators.${c.chemical_indicator}`)}</span></td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[c.status] ?? 'badge-neutral'}`}>{t(`cssd.statuses.${c.status}`)}</span></td>
                  <td className="text-xs">{c.start_time ? new Date(c.start_time).toLocaleString(i18n.language) : '—'}</td>
                  <td>
                    {c.status === 'in_progress' && (
                      <div className="flex gap-1">
                        <button onClick={() => complete(c.id, 'completed')} className="btn-ghost text-xs p-1 text-green-600" title={t('cssd.indicators.pass')}><CheckCircle className="w-3.5 h-3.5" /></button>
                        <button onClick={() => complete(c.id, 'failed')} className="btn-ghost text-xs p-1 text-red-500" title={t('cssd.indicators.fail')}><AlertTriangle className="w-3.5 h-3.5" /></button>
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
        <Modal title={t('cssd.startCycle')} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('cssd.autoclave')}</label><input className="input w-full" value={form.autoclave_id} onChange={e => setForm({...form, autoclave_id: e.target.value})} placeholder="e.g. AC-01" /></div>
              <div><label className="label">{t('cssd.type')}</label>
                <select className="input w-full" value={form.cycle_type} onChange={e => setForm({...form, cycle_type: e.target.value})}>
                  <option value="gravity">{t('cssd.cycleTypes.gravity')}</option>
                  <option value="prevacuum">{t('cssd.cycleTypes.prevacuum')}</option>
                  <option value="flash">{t('cssd.cycleTypes.flash')}</option>
                  <option value="eto">{t('cssd.cycleTypes.eto')}</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="label">{t('temperature', { ns: 'vitals' })}</label><input className="input w-full" type="number" value={form.temperature_celsius} onChange={e => setForm({...form, temperature_celsius: e.target.value})} /></div>
              <div><label className="label">{t('pressure', { ns: 'common' })}</label><input className="input w-full" type="number" value={form.pressure_psi} onChange={e => setForm({...form, pressure_psi: e.target.value})} /></div>
              <div><label className="label">{t('cssd.duration')}</label><input className="input w-full" type="number" value={form.duration_minutes} onChange={e => setForm({...form, duration_minutes: e.target.value})} /></div>
            </div>
            <div><label className="label">{t('cssd.totalSets')}</label>
              <div className="space-y-1 max-h-40 overflow-y-auto border border-[var(--color-border)] rounded-lg p-2">
                {sets.map(s => (
                  <label key={s.id} className="flex items-center gap-2 text-sm py-1">
                    <input type="checkbox" checked={form.instrument_set_ids.includes(s.id)} onChange={e => {
                      setForm(f => ({ ...f, instrument_set_ids: e.target.checked ? [...f.instrument_set_ids, s.id] : f.instrument_set_ids.filter(x => x !== s.id) }));
                    }} />
                    {s.set_name} {s.set_code && <span className="text-xs text-[var(--color-text-muted)]">({s.set_code})</span>}
                  </label>
                ))}
                {sets.length === 0 && <p className="text-xs text-[var(--color-text-muted)]">{t('cssd.noSets')}</p>}
              </div>
            </div>
            <div><label className="label">{t('operator', { ns: 'common' })}</label><input className="input w-full" value={form.operator_name} onChange={e => setForm({...form, operator_name: e.target.value})} /></div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('cssd.starting') : t('cssd.startCycle')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function SetsTab() {
  const { t } = useTranslation('inventory');
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ set_name: '', set_code: '', department: '', item_count: '', description: '' });

  const { data: setsData, isLoading: loading } = useApiQuery<ListResponse<InstrumentSet>>(
    queryKeys.cssd.sets(),
    '/api/cssd/sets',
  );

  const items = setsData?.data ?? [];

  const createSetMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/cssd/sets',
    {
      onSuccess: () => {
        toast.success(t('inventory.success'));
        setShowForm(false);
        setForm({ set_name: '', set_code: '', department: '', item_count: '', description: '' });
        queryClient.invalidateQueries({ queryKey: queryKeys.cssd.all });
      },
      onError: () => {
        toast.error(t('cssd.failed'));
      },
    },
  );

  const saving = createSetMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createSetMutation.mutate({ ...form, item_count: Number(form.item_count) || 0 });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('cssd.addSetBtn')}</button></div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>{t('cssd.setName')}</th><th>{t('cssd.code')}</th><th>{t('cssd.dept')}</th><th>{t('cssd.items')}</th><th>{t('inventory.notes')}</th></tr></thead>
            <tbody>
              {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(5)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : items.length === 0 ? <tr><td colSpan={5} className="text-center py-8 text-[var(--color-text-muted)]">{t('cssd.noSets')}</td></tr>
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
        <Modal title={t('cssd.addSet')} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="label">{t('cssd.setName')} *</label><input className="input w-full" required value={form.set_name} onChange={e => setForm({...form, set_name: e.target.value})} placeholder={t("cssd.setNamePlaceholder")} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('cssd.code')}</label><input className="input w-full" value={form.set_code} onChange={e => setForm({...form, set_code: e.target.value})} /></div>
              <div><label className="label">{t('cssd.itemCount')}</label><input className="input w-full" type="number" value={form.item_count} onChange={e => setForm({...form, item_count: e.target.value})} /></div>
            </div>
            <div><label className="label">{t('cssd.dept')}</label><input className="input w-full" value={form.department} onChange={e => setForm({...form, department: e.target.value})} placeholder={t("cssd.deptPlaceholder")} /></div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('inventory.cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('inventory.loading') : t('cssd.addSetBtn')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function CollectionsTab() {
  const { t, i18n } = useTranslation('inventory');
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ received_from: '', condition: 'dirty', item_count: '', remarks: '' });

  const { data: collectionsData, isLoading: loading } = useApiQuery<ListResponse<Collection>>(
    queryKeys.cssd.collections(),
    '/api/cssd/collections',
  );

  const items = collectionsData?.data ?? [];

  const createCollectionMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/cssd/collections',
    {
      onSuccess: () => {
        toast.success(t('cssd.logged'));
        setShowForm(false);
        setForm({ received_from: '', condition: 'dirty', item_count: '', remarks: '' });
        queryClient.invalidateQueries({ queryKey: queryKeys.cssd.all });
      },
      onError: () => {
        toast.error(t('cssd.failed'));
      },
    },
  );

  const saving = createCollectionMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createCollectionMutation.mutate({ ...form, item_count: Number(form.item_count) || undefined });
  };

  const COND_BADGE: Record<string, string> = { dirty: 'badge-warning', contaminated: 'bg-red-100 text-red-700', damaged: 'bg-orange-100 text-orange-700' };
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('cssd.logCollection')}</button></div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>{t('cssd.setName')}</th><th>{t('cssd.receivedFrom')}</th><th>{t('cssd.condition')}</th><th>{t('cssd.items')}</th><th>{t('cssd.started')}</th><th>{t('inventory.remarks')}</th></tr></thead>
            <tbody>
              {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : items.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">{t('cssd.noCollections')}</td></tr>
              : items.map(c => (
                <tr key={c.id}>
                  <td className="font-medium">{c.set_name ?? '—'}</td>
                  <td>{c.received_from}</td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${COND_BADGE[c.condition] ?? ''}`}>{t(`cssd.conditions.${c.condition}`)}</span></td>
                  <td className="font-data text-center">{c.item_count ? c.item_count.toLocaleString(i18n.language) : '—'}</td>
                  <td className="text-xs">{c.received_at ? new Date(c.received_at).toLocaleString(i18n.language) : '—'}</td>
                  <td className="text-xs text-[var(--color-text-muted)]">{c.remarks ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showForm && (
        <Modal title={t('cssd.logCollection')} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="label">{t('cssd.receivedFrom')} *</label><input className="input w-full" required value={form.received_from} onChange={e => setForm({...form, received_from: e.target.value})} placeholder={t("cssd.receivedFromPlaceholder")} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('cssd.condition')}</label>
                <select className="input w-full" value={form.condition} onChange={e => setForm({...form, condition: e.target.value})}>
                  <option value="dirty">{t('cssd.conditions.dirty')}</option>
                  <option value="contaminated">{t('cssd.conditions.contaminated')}</option>
                  <option value="damaged">{t('cssd.conditions.damaged')}</option>
                </select>
              </div>
              <div><label className="label">{t('cssd.itemCount')}</label><input className="input w-full" type="number" value={form.item_count} onChange={e => setForm({...form, item_count: e.target.value})} /></div>
            </div>
            <div><label className="label">{t('remarks', { ns: 'inventory' })}</label><textarea className="input w-full" rows={2} value={form.remarks} onChange={e => setForm({...form, remarks: e.target.value})} /></div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('loading', { ns: 'common' }) : t('save', { ns: 'common' })}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

const TAB_INFO: Record<Tab, { key: string; icon: typeof Shield }> = {
  inventory: { key: 'cssd.inventoryTab', icon: Package },
  cycles: { key: 'cssd.cyclesTab', icon: Thermometer },
  sets: { key: 'cssd.setsTab', icon: FlaskConical },
  collections: { key: 'cssd.collectionsTab', icon: Clock },
};
const TAB_COMP: Record<Tab, React.ComponentType> = { inventory: InventoryTab, cycles: CyclesTab, sets: SetsTab, collections: CollectionsTab };

export default function CssdManagement({ role }: { role?: string }) {
  const { t } = useTranslation('inventory');
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
            <div><h1 className="page-title">{t('cssd.title')}</h1><p className="section-subtitle">{t('cssd.subtitle')}</p></div>
          </div>
        </div>
        <div className="card p-1.5 flex gap-1 flex-wrap">
          {TABS.map(tKey => { const info = TAB_INFO[tKey]; const Icon = info.icon; return (
            <button key={tKey} onClick={() => setTab(tKey)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${tab === tKey ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}><Icon className="w-4 h-4" />{t(info.key)}</button>
          ); })}
        </div>
        <Content />
      </div>
    </DashboardLayout>
  );
}
