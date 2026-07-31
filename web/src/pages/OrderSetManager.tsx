import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Package, Plus, X, Trash2, Pencil, Search, RefreshCw, ChevronDown, ChevronRight,
  AlertCircle, Pill, FlaskConical, Heart, UtensilsCrossed, ClipboardList, Star,
  CheckCircle2, Shield, UserSearch, Check,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import EmptyState from '../components/dashboard/EmptyState';
import { useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { api } from '../lib/apiClient';

/* ─── Types ─── */
interface OrderSet {
  id: number;
  name: string;
  description?: string;
  specialty: string;
  category: string;
  item_count: number;
  is_active: boolean;
  created_by?: string;
  created_at?: string;
}

interface MedicationItem {
  id: number;
  type: 'medication';
  name: string;
  dose?: string;
  route?: string;
  frequency?: string;
  duration?: string;
  priority: 'stat' | 'urgent' | 'routine';
  is_optional: boolean;
  notes?: string;
}

interface LabTestItem {
  id: number;
  type: 'lab_test';
  test_code?: string;
  name: string;
  description?: string;
  priority: 'stat' | 'urgent' | 'routine';
  is_optional: boolean;
}

interface NursingOrderItem {
  id: number;
  type: 'nursing_order';
  name: string;
  description?: string;
  priority: 'stat' | 'urgent' | 'routine';
  is_optional: boolean;
}

interface DietOrderItem {
  id: number;
  type: 'diet_order';
  name: string;
  description?: string;
  priority: 'stat' | 'urgent' | 'routine';
  is_optional: boolean;
}

interface InstructionItem {
  id: number;
  type: 'instruction';
  name: string;
  description?: string;
  priority: 'stat' | 'urgent' | 'routine';
  is_optional: boolean;
}

type OrderSetItem = MedicationItem | LabTestItem | NursingOrderItem | DietOrderItem | InstructionItem;

interface OrderSetDetail extends OrderSet {
  items: OrderSetItem[];
}

interface Favorite {
  id: number;
  order_set_id: number;
  order_set_name: string;
  specialty: string;
  category: string;
  created_at: string;
}

interface ApplyOverride {
  item_id: number;
  dose?: string;
  frequency?: string;
}

interface ApplyResult {
  prescriptions_created: number;
  lab_orders_created: number;
  nursing_notes_created: number;
  diet_orders_created: number;
  instructions_created: number;
}

interface DrugWarning {
  item_id: number;
  item_name: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
}

/* ─── Constants ─── */
const SPECIALTIES = [
  'all', 'general', 'internal_medicine', 'surgery', 'pediatrics', 'ob_gyn',
  'cardiology', 'neurology', 'orthopedics', 'ent', 'dermatology', 'psychiatry',
  'emergency', 'icu', 'oncology', 'nephrology', 'pulmonology',
];

const CATEGORIES = [
  'all', 'admission', 'discharge', 'pre_op', 'post_op', 'emergency',
  'routine', 'chronic_disease', 'diagnostic', 'preventive',
];

const ITEM_TYPES = ['medication', 'lab_test', 'nursing_order', 'diet_order', 'instruction'] as const;

const PRIORITIES = ['stat', 'urgent', 'routine'] as const;

const ROUTES = ['PO', 'IV', 'IM', 'SC', 'SL', 'PR', 'INH', 'TOP', 'OPH', 'OT'];
const FREQUENCIES = ['STAT', 'OD', 'BD', 'TDS', 'QID', 'Q4H', 'Q6H', 'Q8H', 'Q12H', 'PRN', 'HS', 'AC', 'PC'];

const EMPTY_ORDER_SET_FORM = {
  name: '',
  description: '',
  specialty: 'general',
  category: 'routine',
};

const EMPTY_ITEM_FORM = {
  type: 'medication' as typeof ITEM_TYPES[number],
  name: '',
  description: '',
  dose: '',
  route: 'PO',
  frequency: 'OD',
  duration: '',
  test_code: '',
  priority: 'routine' as typeof PRIORITIES[number],
  is_optional: false,
};

/* ─── Helpers ─── */
function priorityBadge(p: string): string {
  switch (p) {
    case 'stat': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    case 'urgent': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
    default: return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
  }
}

function specialtyLabel(s: string, t: any): string {
  if (s === 'all') return t('search.specialty');
  return t(`specialties.${s}`) || s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function categoryLabel(c: string, t: any): string {
  if (c === 'all') return t('search.category');
  return t(`categories.${c}`) || c.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

function typeIcon(type: string) {
  switch (type) {
    case 'medication': return <Pill className="w-4 h-4 text-blue-500" />;
    case 'lab_test': return <FlaskConical className="w-4 h-4 text-green-500" />;
    case 'nursing_order': return <Heart className="w-4 h-4 text-purple-500" />;
    case 'diet_order': return <UtensilsCrossed className="w-4 h-4 text-orange-500" />;
    case 'instruction': return <ClipboardList className="w-4 h-4 text-gray-500" />;
    default: return <Package className="w-4 h-4" />;
  }
}

function typeSectionColor(type: string): string {
  switch (type) {
    case 'medication': return 'border-blue-200 dark:border-blue-800';
    case 'lab_test': return 'border-green-200 dark:border-green-800';
    case 'nursing_order': return 'border-purple-200 dark:border-purple-800';
    case 'diet_order': return 'border-orange-200 dark:border-orange-800';
    case 'instruction': return 'border-gray-200 dark:border-gray-700';
    default: return 'border-[var(--color-border)]';
  }
}

function typeSectionBg(type: string): string {
  switch (type) {
    case 'medication': return 'bg-blue-50/50 dark:bg-blue-900/10';
    case 'lab_test': return 'bg-green-50/50 dark:bg-green-900/10';
    case 'nursing_order': return 'bg-purple-50/50 dark:bg-purple-900/10';
    case 'diet_order': return 'bg-orange-50/50 dark:bg-orange-900/10';
    case 'instruction': return 'bg-gray-50/50 dark:bg-gray-900/10';
    default: return '';
  }
}

function typeLabel(type: string, t: any): string {
  return t(`sections.${type}`) || type;
}

function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {[...Array(4)].map((_, i) => (
        <tr key={i}>
          {[...Array(cols)].map((_, j) => (
            <td key={j}><div className="skeleton h-4 w-full rounded" /></td>
          ))}
        </tr>
      ))}
    </>
  );
}

function SkeletonCards() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="card p-4 space-y-3">
          <div className="skeleton h-5 w-3/4 rounded" />
          <div className="skeleton h-4 w-1/2 rounded" />
          <div className="skeleton h-4 w-1/3 rounded" />
        </div>
      ))}
    </div>
  );
}

/* ─── Modal ─── */
function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className={`bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800 z-10">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ─── Order Set Form Modal ─── */
function OrderSetFormModal({
  orderSet,
  onClose,
  onSaved,
}: {
  orderSet?: OrderSet | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation(['orders', 'common']);
  const [form, setForm] = useState(
    orderSet
      ? { name: orderSet.name, description: orderSet.description ?? '', specialty: orderSet.specialty, category: orderSet.category }
      : { ...EMPTY_ORDER_SET_FORM }
  );
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (orderSet) {
        await api.put(`/api/order-sets/${orderSet.id}`, form);
        toast.success(t('status.orderSetUpdated'));
      } else {
        await api.post('/api/order-sets', form);
        toast.success(t('status.orderSetCreated'));
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={orderSet ? t('modals.edit.title') : t('modals.create.title')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <div><label className="label">{t('modals.create.name')}</label><input className="input" required value={form.name} onChange={e => set('name', e.target.value)} placeholder={t('modals.create.namePlaceholder')} /></div>
        <div><label className="label">{t('modals.create.description')}</label><textarea className="input min-h-[80px]" value={form.description} onChange={e => set('description', e.target.value)} placeholder={t('modals.create.descPlaceholder')} /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className="label">{t('modals.create.specialty')}</label><select className="input" value={form.specialty} onChange={e => set('specialty', e.target.value)}>{SPECIALTIES.filter(s => s !== 'all').map(s => (<option key={s} value={s}>{specialtyLabel(s, t)}</option>))}</select></div>
          <div><label className="label">{t('modals.create.category')}</label><select className="input" value={form.category} onChange={e => set('category', e.target.value)}>{CATEGORIES.filter(c => c !== 'all').map(c => (<option key={c} value={c}>{categoryLabel(c, t)}</option>))}</select></div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">{t('common:cancel')}</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common:saving') : orderSet ? t('modals.edit.submit') : t('modals.create.submit')}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ─── Add Item Modal ─── */
function AddItemModal({ orderSetId, onClose, onSaved }: { orderSetId: number; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation(['orders', 'common']);
  const [form, setForm] = useState({ ...EMPTY_ITEM_FORM });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const body: Record<string, any> = { type: form.type, name: form.name, priority: form.priority, is_optional: form.is_optional };
    if (form.description) body.description = form.description;
    if (form.type === 'medication') { if (form.dose) body.dose = form.dose; if (form.route) body.route = form.route; if (form.frequency) body.frequency = form.frequency; if (form.duration) body.duration = form.duration; }
    if (form.type === 'lab_test' && form.test_code) body.test_code = form.test_code;
    try {
      await api.post(`/api/order-sets/${orderSetId}/items`, body);
      toast.success(t('status.itemAdded'));
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t('modals.addItem.title')} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className="label">{t('modals.addItem.itemType')}</label><select className="input" value={form.type} onChange={e => set('type', e.target.value)}>{ITEM_TYPES.map(type => (<option key={type} value={type}>{typeLabel(type, t)}</option>))}</select></div>
          <div><label className="label">{t('modals.addItem.priority')}</label><select className="input" value={form.priority} onChange={e => set('priority', e.target.value)}>{PRIORITIES.map(p => (<option key={p} value={p}>{t(`priorities.${p}`) || p}</option>))}</select></div>
        </div>
        <div><label className="label">{t('modals.addItem.name')}</label><input className="input" required value={form.name} onChange={e => set('name', e.target.value)} placeholder={form.type === 'medication' ? t('modals.addItem.namePlaceholderMed') : t('modals.addItem.namePlaceholderLab')} /></div>
        {form.type === 'medication' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div><label className="label">{t('modals.addItem.dose')}</label><input className="input" value={form.dose} onChange={e => set('dose', e.target.value)} placeholder="81mg" /></div>
            <div><label className="label">{t('modals.addItem.route')}</label><select className="input" value={form.route} onChange={e => set('route', e.target.value)}>{ROUTES.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
            <div><label className="label">{t('modals.addItem.frequency')}</label><select className="input" value={form.frequency} onChange={e => set('frequency', e.target.value)}>{FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}</select></div>
            <div><label className="label">{t('modals.addItem.duration')}</label><input className="input" value={form.duration} onChange={e => set('duration', e.target.value)} placeholder="7 days" /></div>
          </div>
        )}
        {form.type === 'lab_test' && (<div><label className="label">{t('modals.addItem.testCode')}</label><input className="input" value={form.test_code} onChange={e => set('test_code', e.target.value)} placeholder="e.g. CBC, BMP, CMP" /></div>)}
        {(form.type !== 'medication') && (<div><label className="label">{t('modals.addItem.description')}</label><textarea className="input min-h-[60px]" value={form.description} onChange={e => set('description', e.target.value)} placeholder="Additional details..." /></div>)}
        <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.is_optional} onChange={e => set('is_optional', e.target.checked)} className="rounded" /><span className="text-sm">{t('modals.addItem.optional')}</span></label>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">{t('common:cancel')}</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common:saving') : t('modals.addItem.submit')}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ─── Apply to Patient Modal ─── */
function ApplyModal({ orderSet, onClose }: { orderSet: OrderSetDetail; onClose: () => void }) {
  const { t } = useTranslation(['orders', 'common', 'patients']);
  const [patientSearch, setPatientSearch] = useState('');
  const [patientId, setPatientId] = useState<number | null>(null);
  const [patientName, setPatientName] = useState('');
  const [visitId, setVisitId] = useState('');
  const [checkedItems, setCheckedItems] = useState<Set<number>>(() => { const initial = new Set<number>(); orderSet.items.forEach(item => { if (!item.is_optional) initial.add(item.id); }); return initial; });
  const [overrides, setOverrides] = useState<Record<number, { dose?: string; frequency?: string }>>({});
  const [step, setStep] = useState<'select' | 'safety' | 'result'>('select');
  const [warnings, setWarnings] = useState<DrugWarning[]>([]);
  const [applying, setApplying] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [searchResults, setSearchResults] = useState<Array<{ id: number; name: string; mrn: string }>>([]);
  const [searching, setSearching] = useState(false);

  const toggleItem = (id: number) => { setCheckedItems(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };
  const setOverride = (itemId: number, field: 'dose' | 'frequency', value: string) => { setOverrides(prev => ({ ...prev, [itemId]: { ...prev[itemId], [field]: value } })); };

  const searchPatients = useCallback(async (query: string) => {
    if (query.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const data = await api.get<{ data?: any[]; patients?: any[] }>('/api/patients', { search: query, limit: '10' } as any);
      setSearchResults((data as any).data ?? (data as any).patients ?? (data as unknown as any[]) ?? []);
    } catch { setSearchResults([]); } finally { setSearching(false); }
  }, []);

  useEffect(() => { const timer = setTimeout(() => searchPatients(patientSearch), 300); return () => clearTimeout(timer); }, [patientSearch, searchPatients]);

  const handleCheckSafety = async () => {
    if (!patientId) { toast.error(t('modals.apply.patient') + ' ' + t('common:required')); return; }
    setChecking(true);
    try {
      const selectedItemIds = Array.from(checkedItems);
      const overridesList: ApplyOverride[] = selectedItemIds.filter(id => overrides[id]).map(id => ({ item_id: id, ...overrides[id] }));
      const data = await api.post<{ warnings?: DrugWarning[] }>(`/api/order-sets/${orderSet.id}/apply`, { patient_id: patientId, visit_id: visitId || undefined, item_ids: selectedItemIds, overrides: overridesList, dry_run: true });
      setWarnings((data as any).warnings ?? []);
      setStep('safety');
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : t('modals.apply.checkSafety') + ' ' + t('common:failed')); } finally { setChecking(false); }
  };

  const handleApply = async () => {
    if (!patientId) return;
    setApplying(true);
    try {
      const selectedItemIds = Array.from(checkedItems);
      const overridesList: ApplyOverride[] = selectedItemIds.filter(id => overrides[id]).map(id => ({ item_id: id, ...overrides[id] }));
      const data = await api.post<{ data?: ApplyResult }>(`/api/order-sets/${orderSet.id}/apply`, { patient_id: patientId, visit_id: visitId || undefined, item_ids: selectedItemIds, overrides: overridesList });
      setResult((data as any).data ?? data);
      setStep('result');
      toast.success(t('modals.apply.success'));
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : t('common:operationFailed')); } finally { setApplying(false); }
  };

  const sections = [
    { label: t('sections.medication'), items: orderSet.items.filter(i => i.type === 'medication'), type: 'medication' },
    { label: t('sections.lab_test'), items: orderSet.items.filter(i => i.type === 'lab_test'), type: 'lab_test' },
    { label: t('sections.nursing_order'), items: orderSet.items.filter(i => i.type === 'nursing_order'), type: 'nursing_order' },
    { label: t('sections.diet_order'), items: orderSet.items.filter(i => i.type === 'diet_order'), type: 'diet_order' },
    { label: t('sections.instruction'), items: orderSet.items.filter(i => i.type === 'instruction'), type: 'instruction' },
  ].filter(s => s.items.length > 0);

  return (
    <Modal title={t('modals.apply.title', { name: orderSet.name })} onClose={onClose} wide>
      <div className="p-5 space-y-5">
        {step === 'select' && (<>
          <div className="space-y-3">
            <h4 className="font-semibold text-sm uppercase text-[var(--color-text-secondary)]">{t('modals.apply.patient')}</h4>
            {patientId ? (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"><CheckCircle2 className="w-5 h-5 text-green-600" /><span className="font-medium">{patientName}</span><button onClick={() => { setPatientId(null); setPatientName(''); setPatientSearch(''); }} className="btn-ghost p-1 ml-auto"><X className="w-4 h-4" /></button></div>
            ) : (
              <div className="relative"><UserSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" /><input className="input pl-10" placeholder={t('modals.apply.searchPlaceholder')} value={patientSearch} onChange={e => setPatientSearch(e.target.value)} />{searching && (<RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-[var(--color-text-muted)]" />)}{searchResults.length > 0 && !patientId && (<div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-[var(--color-border)] z-20 max-h-48 overflow-y-auto">{searchResults.map(p => (<button key={p.id} type="button" className="w-full text-left px-4 py-2.5 hover:bg-[var(--color-border-light)] flex items-center gap-3 transition-colors" onClick={() => { setPatientId(p.id); setPatientName(`${p.name} (${p.mrn})`); setSearchResults([]); setPatientSearch(''); }}><span className="font-medium">{p.name}</span><span className="text-sm text-[var(--color-text-secondary)]">{p.mrn}</span></button>))}</div>)}</div>
            )}
            <div><label className="label">{t('modals.apply.visitId')}</label><input className="input" value={visitId} onChange={e => setVisitId(e.target.value)} placeholder={t('modals.apply.visitIdPlaceholder')} /></div>
          </div>
          <div className="space-y-4">
            <h4 className="font-semibold text-sm uppercase text-[var(--color-text-secondary)]">{t('modals.apply.itemsToApply')}</h4>
            {sections.map(section => (
              <div key={section.type} className={`rounded-lg border ${typeSectionColor(section.type)} overflow-hidden`}>
                <div className={`px-4 py-2.5 ${typeSectionBg(section.type)} flex items-center gap-2`}>{typeIcon(section.type)}<span className="font-medium text-sm">{section.label}</span><span className="text-xs text-[var(--color-text-secondary)]">({section.items.length})</span></div>
                <div className="divide-y divide-[var(--color-border)]">
                  {section.items.map(item => (
                    <div key={item.id} className={`px-4 py-3 flex flex-col gap-2 ${item.is_optional ? 'border-l-2 border-dashed border-[var(--color-text-muted)]' : ''}`}>
                      <div className="flex items-center gap-3"><input type="checkbox" checked={checkedItems.has(item.id)} onChange={() => toggleItem(item.id)} className="rounded" /><span className="font-medium text-sm flex-1">{item.name}</span><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityBadge(item.priority)}`}>{t(`priorities.${item.priority}`) || item.priority}</span>{item.is_optional && (<span className="text-xs text-[var(--color-text-muted)] italic">{t('common:optional')}</span>)}</div>
                      {item.type === 'medication' && checkedItems.has(item.id) && (
                        <div className="ml-7 grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <div><label className="text-xs text-[var(--color-text-secondary)]">{t('modals.addItem.dose')}</label><input className="input text-sm py-1" placeholder={(item as MedicationItem).dose ?? t('modals.addItem.dose').toLowerCase()} value={overrides[item.id]?.dose ?? ''} onChange={e => setOverride(item.id, 'dose', e.target.value)} /></div>
                          <div><label className="text-xs text-[var(--color-text-secondary)]">{t('modals.addItem.frequency')}</label><input className="input text-sm py-1" placeholder={(item as MedicationItem).frequency ?? t('modals.addItem.frequency').toLowerCase()} value={overrides[item.id]?.frequency ?? ''} onChange={e => setOverride(item.id, 'frequency', e.target.value)} /></div>
                          <div className="col-span-2 text-xs text-[var(--color-text-muted)] self-end pb-1">{(item as MedicationItem).route && `${(item as MedicationItem).route}`}{(item as MedicationItem).duration && ` / ${(item as MedicationItem).duration}`}</div>
                        </div>
                      )}
                      {item.type !== 'medication' && 'description' in item && item.description && (<p className="ml-7 text-xs text-[var(--color-text-secondary)]">{item.description}</p>)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={onClose} className="btn-secondary">{t('common:cancel')}</button><button type="button" onClick={handleCheckSafety} disabled={!patientId || checkedItems.size === 0 || checking} className="btn-primary">{checking ? (<><RefreshCw className="w-4 h-4 animate-spin" />{t('modals.apply.checking')}</>) : (<><Shield className="w-4 h-4" />{t('modals.apply.checkSafety')}</>)}</button></div>
        </>)}
        {step === 'safety' && (<>
          <div className="space-y-4"><h4 className="font-semibold text-sm uppercase text-[var(--color-text-secondary)]">{t('modals.apply.safetyResults')}</h4>
            {warnings.length === 0 ? (<div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"><CheckCircle2 className="w-6 h-6 text-green-600" /><div><p className="font-medium text-green-800 dark:text-green-300">{t('modals.apply.noSafetyConcerns')}</p><p className="text-sm text-green-600 dark:text-green-400">{t('modals.apply.noSafetyConcernsDesc')}</p></div></div>) : (
              <div className="space-y-3">{warnings.map((w, i) => (<div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${w.severity === 'high' ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : w.severity === 'medium' ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'}`}><AlertCircle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${w.severity === 'high' ? 'text-red-500' : w.severity === 'medium' ? 'text-yellow-500' : 'text-blue-500'}`} /><div><p className="font-medium text-sm">{w.item_name}</p><p className="text-sm text-[var(--color-text-secondary)]">{w.message}</p></div><span className={`text-xs px-2 py-0.5 rounded-full font-medium ml-auto flex-shrink-0 ${w.severity === 'high' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' : w.severity === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'}`}>{w.severity}</span></div>))}</div>
            )}</div>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setStep('select')} className="btn-secondary">{t('common:back')}</button><button type="button" onClick={handleApply} disabled={applying} className="btn-primary">{applying ? (<><RefreshCw className="w-4 h-4 animate-spin" />{t('modals.apply.applying')}</>) : (<><Check className="w-4 h-4" />{t('modals.apply.applyOrderSet')}</>)}</button></div>
        </>)}
        {step === 'result' && result && (<>
          <div className="space-y-4"><div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"><CheckCircle2 className="w-8 h-8 text-green-600" /><div><p className="font-semibold text-green-800 dark:text-green-300">{t('modals.apply.success')}</p><p className="text-sm text-green-600 dark:text-green-400">{t('modals.apply.appliedTo', { name: patientName })}</p></div></div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {result.prescriptions_created > 0 && (<div className="card p-3 text-center"><Pill className="w-5 h-5 text-blue-500 mx-auto mb-1" /><p className="text-2xl font-bold">{result.prescriptions_created}</p><p className="text-xs text-[var(--color-text-secondary)]">{t('modals.apply.prescriptions')}</p></div>)}
              {result.lab_orders_created > 0 && (<div className="card p-3 text-center"><FlaskConical className="w-5 h-5 text-green-500 mx-auto mb-1" /><p className="text-2xl font-bold">{result.lab_orders_created}</p><p className="text-xs text-[var(--color-text-secondary)]">{t('modals.apply.labOrders')}</p></div>)}
              {result.nursing_notes_created > 0 && (<div className="card p-3 text-center"><Heart className="w-5 h-5 text-purple-500 mx-auto mb-1" /><p className="text-2xl font-bold">{result.nursing_notes_created}</p><p className="text-xs text-[var(--color-text-secondary)]">{t('modals.apply.nursingNotes')}</p></div>)}
              {result.diet_orders_created > 0 && (<div className="card p-3 text-center"><UtensilsCrossed className="w-5 h-5 text-orange-500 mx-auto mb-1" /><p className="text-2xl font-bold">{result.diet_orders_created}</p><p className="text-xs text-[var(--color-text-secondary)]">{t('modals.apply.dietOrders')}</p></div>)}
              {result.instructions_created > 0 && (<div className="card p-3 text-center"><ClipboardList className="w-5 h-5 text-gray-500 mx-auto mb-1" /><p className="text-2xl font-bold">{result.instructions_created}</p><p className="text-xs text-[var(--color-text-secondary)]">{t('modals.apply.instructions')}</p></div>)}
            </div></div>
          <div className="flex justify-end pt-2"><button type="button" onClick={onClose} className="btn-primary">{t('common:done')}</button></div>
        </>)}
      </div>
    </Modal>
  );
}

/* ─── Order Set Detail Panel ─── */
function OrderSetDetailPanel({ orderSet, onClose, onReload, isAdmin }: { orderSet: OrderSetDetail; onClose: () => void; onReload: () => void; isAdmin: boolean }) {
  const { t } = useTranslation(['orders', 'common']);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showApply, setShowApply] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState<number | null>(null);

  const handleDeleteItem = async (itemId: number) => {
    if (!confirm(t('status.removeItemConfirm'))) return;
    setDeletingItemId(itemId);
    try {
      await api.delete(`/api/order-sets/${orderSet.id}/items/${itemId}`);
      toast.success(t('status.itemRemoved'));
      onReload();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('common:failed'));
    } finally {
      setDeletingItemId(null);
    }
  };

  const medications = orderSet.items.filter(i => i.type === 'medication') as MedicationItem[];
  const labTests = orderSet.items.filter(i => i.type === 'lab_test') as LabTestItem[];
  const nursingOrders = orderSet.items.filter(i => i.type === 'nursing_order') as NursingOrderItem[];
  const dietOrders = orderSet.items.filter(i => i.type === 'diet_order') as DietOrderItem[];
  const instructions = orderSet.items.filter(i => i.type === 'instruction') as InstructionItem[];

  const renderItemRow = (item: OrderSetItem, extra?: React.ReactNode) => (
    <div key={item.id} className={`flex items-center gap-3 px-4 py-3 ${item.is_optional ? 'border-l-2 border-dashed border-[var(--color-text-muted)]' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{item.name}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityBadge(item.priority)}`}>
            {t(`priorities.${item.priority}`) || item.priority}
          </span>
          {item.is_optional && (<span className="text-xs italic text-[var(--color-text-muted)]">{t('common:optional')}</span>)}
        </div>
        {extra}
      </div>
      {isAdmin && (
        <button
          onClick={() => handleDeleteItem(item.id)}
          disabled={deletingItemId === item.id}
          className="btn-ghost p-1.5 text-red-500 flex-shrink-0"
        >
          {deletingItemId === item.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </button>
      )}
    </div>
  );

  const renderSection = (icon: React.ReactNode, type: string, items: OrderSetItem[], extra?: (item: any) => React.ReactNode) => items.length > 0 && (
    <div className={`card overflow-hidden border-l-4 ${typeSectionColor(type)}`}>
      <div className={`px-4 py-3 ${typeSectionBg(type)} flex items-center gap-2 border-b border-[var(--color-border)]`}>
        {icon}
        <span className="font-semibold text-sm">{typeLabel(type, t)}</span>
        <span className="text-xs text-[var(--color-text-secondary)]">({items.length})</span>
      </div>
      <div className="divide-y divide-[var(--color-border)]">
        {items.map(item => renderItemRow(item, extra?.(item)))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-lg truncate">{orderSet.name}</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {specialtyLabel(orderSet.specialty, t)} / {categoryLabel(orderSet.category, t)}
            {orderSet.description && ` — ${orderSet.description}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => setShowApply(true)} className="btn-primary text-sm">
            <Check className="w-4 h-4" />
            {t('actions.apply')}
          </button>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
        </div>
      </div>
      {isAdmin && (
        <div className="flex justify-end">
          <button onClick={() => setShowAddItem(true)} className="btn-secondary text-sm">
            <Plus className="w-4 h-4" />
            {t('actions.addItem')}
          </button>
        </div>
      )}
      {orderSet.items.length === 0 ? (
        <div className="card p-8">
          <EmptyState
            icon={<ClipboardList className="w-8 h-8 text-[var(--color-text-muted)]" />}
            title={t('detail.emptyTitle')}
            description={t('detail.emptyDesc')}
            action={isAdmin ? (
              <button onClick={() => setShowAddItem(true)} className="btn-primary mt-2">
                <Plus className="w-4 h-4" />
                {t('actions.addFirstItem')}
              </button>
            ) : undefined}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {renderSection(<Pill className="w-4 h-4 text-blue-500" />, 'medication', medications, (item: MedicationItem) => (
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
              {[item.dose, item.route, item.frequency, item.duration].filter(Boolean).join(' / ')}
            </p>
          ))}
          {renderSection(<FlaskConical className="w-4 h-4 text-green-500" />, 'lab_test', labTests, (item: LabTestItem) => (
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
              {item.test_code && <span className="font-data">{item.test_code}</span>}
              {item.test_code && item.description && ' — '}
              {item.description}
            </p>
          ))}
          {renderSection(<Heart className="w-4 h-4 text-purple-500" />, 'nursing_order', nursingOrders, (item: NursingOrderItem) => item.description ? <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{item.description}</p> : undefined)}
          {renderSection(<UtensilsCrossed className="w-4 h-4 text-orange-500" />, 'diet_order', dietOrders, (item: DietOrderItem) => item.description ? <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{item.description}</p> : undefined)}
          {renderSection(<ClipboardList className="w-4 h-4 text-gray-500" />, 'instruction', instructions, (item: InstructionItem) => item.description ? <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{item.description}</p> : undefined)}
        </div>
      )}
      {showAddItem && <AddItemModal orderSetId={orderSet.id} onClose={() => setShowAddItem(false)} onSaved={onReload} />}
      {showApply && <ApplyModal orderSet={orderSet} onClose={() => setShowApply(false)} />}
    </div>
  );
}

/* ─── Favorites Tab ─── */
function FavoritesTab({ onSelectOrderSet }: { onSelectOrderSet: (id: number) => void }) {
  const { t, i18n } = useTranslation(['orders', 'common']);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ data?: Favorite[] }>('/api/order-sets/favorites/list');
      setFavorites((data as any).data ?? (data as unknown as Favorite[]) ?? []);
    } catch {
      setError(t('status.loadFavoritesFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const handleRemove = async (favId: number) => {
    if (!confirm(t('status.removeFavoriteConfirm'))) return;
    try {
      await api.delete(`/api/order-sets/favorites/${favId}`);
      toast.success(t('status.favoriteRemoved'));
      load();
    } catch {
      toast.error(t('status.favoriteRemoveFailed'));
    }
  };

  if (error) return (
    <div className="card p-8 text-center">
      <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
      <p className="text-[var(--color-text-secondary)] mb-3">{error}</p>
      <button onClick={load} className="btn-primary">
        <RefreshCw className="w-4 h-4" />
        {t('common:retry')}
      </button>
    </div>
  );
  if (loading) return <SkeletonCards />;
  if (favorites.length === 0) return (
    <div className="card p-8">
      <EmptyState
        icon={<Star className="w-8 h-8 text-[var(--color-text-muted)]" />}
        title={t('favorites.emptyTitle')}
        description={t('favorites.emptyDesc')}
      />
    </div>
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {favorites.map(fav => (
        <div
          key={fav.id}
          className="card p-4 hover:shadow-md transition-shadow cursor-pointer group"
          onClick={() => onSelectOrderSet(fav.order_set_id)}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Star className="w-4 h-4 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                <h4 className="font-medium text-sm truncate">{fav.order_set_name}</h4>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-border-light)] text-[var(--color-text-secondary)]">
                  {specialtyLabel(fav.specialty, t)}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-border-light)] text-[var(--color-text-secondary)]">
                  {categoryLabel(fav.category, t)}
                </span>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] mt-2">
                {t('favorites.savedAt', { date: new Date(fav.created_at).toLocaleDateString(i18n.language === 'bn' ? 'bn-BD' : 'en-GB') })}
              </p>
            </div>
            <button
              onClick={e => { e.stopPropagation(); handleRemove(fav.id); }}
              className="btn-ghost p-1.5 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Main Page ─── */
export default function OrderSetManager({ role = 'doctor' }: { role?: string }) {
  const { t } = useTranslation(['orders', 'common', 'patients']);
  const isAdmin = role === 'hospital_admin' || role === 'doctor';
  const queryClient = useQueryClient();

  const [orderSets, setOrderSets] = useState<OrderSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [specialtyFilter, setSpecialtyFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<OrderSetDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editOrderSet, setEditOrderSet] = useState<OrderSet | null>(null);
  const [activeTab, setActiveTab] = useState<'order_sets' | 'favorites'>('order_sets');

  const loadOrderSets = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (specialtyFilter !== 'all') params.set('specialty', specialtyFilter);
      if (categoryFilter !== 'all') params.set('category', categoryFilter);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      const qs = params.toString() ? `?${params.toString()}` : '';
      const data = await api.get<{ data?: OrderSet[] }>(`/api/order-sets${qs}`);
      setOrderSets((data as any).data ?? (data as unknown as OrderSet[]) ?? []);
    } catch { setError(t('common:errorLoading')); } finally { setLoading(false); }
  }, [specialtyFilter, categoryFilter, searchQuery, t]);

  useEffect(() => { loadOrderSets(); }, [loadOrderSets]);

  const loadDetail = useCallback(async (id: number) => {
    setLoadingDetail(true);
    try { const data = await api.get<{ data?: OrderSetDetail }>(`/api/order-sets/${id}`); setDetail((data as any).data ?? data); } catch { toast.error(t('detail.loadFailed')); setDetail(null); } finally { setLoadingDetail(false); }
  }, [t]);

  const selectOrderSet = useCallback((id: number) => { setSelectedId(id); setActiveTab('order_sets'); loadDetail(id); }, [loadDetail]);

  const handleDelete = async (id: number) => {
    if (!confirm(t('status.deactivateConfirm') || 'Deactivate this order set?')) return;
    try { await api.delete(`/api/order-sets/${id}`); toast.success(t('status.deactivated')); if (selectedId === id) { setSelectedId(null); setDetail(null); } queryClient.invalidateQueries({ queryKey: queryKeys.orderSets.all }); loadOrderSets(); } catch (err: unknown) { toast.error(err instanceof Error ? err.message : t('common:failed')); }
  };

  const handleSaveFavorite = async (orderSetId: number) => {
    try { await api.post('/api/order-sets/favorites', { order_set_id: orderSetId }); toast.success(t('status.savedFavorite')); queryClient.invalidateQueries({ queryKey: queryKeys.orderSets.favorites() }); } catch (err: unknown) { toast.error(err instanceof Error ? err.message : t('common:failed')); }
  };

  const filteredSets = useMemo(() => orderSets, [orderSets]);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center shadow-lg shadow-indigo-500/20"><Package className="w-5 h-5 text-white" /></div><div><h1 className="page-title">{t('title')}</h1><p className="section-subtitle">{t('subtitle')}</p></div></div></div>
        <div className="card p-1.5 flex gap-1">
          <button onClick={() => setActiveTab('order_sets')} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'order_sets' ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}><Package className="w-4 h-4" />{t('tabs.orderSets')}</button>
          <button onClick={() => setActiveTab('favorites')} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'favorites' ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}><Star className="w-4 h-4" />{t('tabs.favorites')}</button>
        </div>
        {activeTab === 'favorites' && <FavoritesTab onSelectOrderSet={selectOrderSet} />}
        {activeTab === 'order_sets' && (
          <div className="flex flex-col lg:flex-row gap-5">
            <div className={`${selectedId ? 'lg:w-1/2' : 'w-full'} space-y-4 transition-all`}>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" /><input className="input pl-10" placeholder={t('search.placeholder')} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} /></div>
                <select className="input w-full sm:w-auto" value={specialtyFilter} onChange={e => setSpecialtyFilter(e.target.value)}>{SPECIALTIES.map(s => (<option key={s} value={s}>{specialtyLabel(s, t)}</option>))}</select>
                <select className="input w-full sm:w-auto" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>{CATEGORIES.map(c => (<option key={c} value={c}>{categoryLabel(c, t)}</option>))}</select>
                {isAdmin && (<button onClick={() => { setEditOrderSet(null); setShowForm(true); }} className="btn-primary whitespace-nowrap"><Plus className="w-4 h-4" />{t('actions.createNew')}</button>)}
              </div>
              {error ? (<div className="card p-8 text-center"><AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" /><p className="text-[var(--color-text-secondary)] mb-3">{error}</p><button onClick={loadOrderSets} className="btn-primary"><RefreshCw className="w-4 h-4" />{t('common:retry')}</button></div>)
              : loading ? (<div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>{t('table.name')}</th><th className="hidden sm:table-cell">{t('table.specialty')}</th><th className="hidden md:table-cell">{t('table.category')}</th><th>{t('table.items')}</th><th></th></tr></thead><tbody><SkeletonRows cols={5} /></tbody></table></div></div>)
              : filteredSets.length === 0 ? (<div className="card p-8"><EmptyState icon={<Package className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('search.noResultsTitle') || 'No order sets found'} description={searchQuery || specialtyFilter !== 'all' || categoryFilter !== 'all' ? t('search.noResultsDesc') || 'Try adjusting your filters or search query.' : t('search.emptyDesc') || 'Create your first order set to bundle common orders together.'} action={isAdmin && !searchQuery ? (<button onClick={() => { setEditOrderSet(null); setShowForm(true); }} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('actions.createOrderSet')}</button>) : undefined} /></div>)
              : (<div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>{t('table.name')}</th><th className="hidden sm:table-cell">{t('table.specialty')}</th><th className="hidden md:table-cell">{t('table.category')}</th><th>{t('table.items')}</th><th></th></tr></thead><tbody>
                {filteredSets.map(os => (
                  <tr key={os.id} className={`cursor-pointer transition-colors ${selectedId === os.id ? 'bg-[var(--color-primary)]/5' : 'hover:bg-[var(--color-border-light)]'}`} onClick={() => selectOrderSet(os.id)}>
                    <td><div className="font-medium">{os.name}</div>{os.description && (<p className="text-xs text-[var(--color-text-secondary)] truncate max-w-xs">{os.description}</p>)}</td>
                    <td className="hidden sm:table-cell"><span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 font-medium">{specialtyLabel(os.specialty, t)}</span></td>
                    <td className="hidden md:table-cell"><span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-border-light)] text-[var(--color-text-secondary)] font-medium">{categoryLabel(os.category, t)}</span></td>
                    <td><span className="font-data text-sm">{os.item_count}</span></td>
                    <td><div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <button onClick={() => handleSaveFavorite(os.id)} className="btn-ghost p-1.5" title={t('actions.saveFavorite')}><Star className="w-4 h-4" /></button>
                      {isAdmin && (<><button onClick={() => { setEditOrderSet(os); setShowForm(true); }} className="btn-ghost p-1.5" title={t('actions.edit')}><Pencil className="w-4 h-4" /></button><button onClick={() => handleDelete(os.id)} className="btn-ghost p-1.5 text-red-500" title={t('actions.deactivate')}><Trash2 className="w-4 h-4" /></button></>)}
                    </div></td>
                  </tr>
                ))}
              </tbody></table></div></div>)}
            </div>
            {selectedId && (
              <div className="lg:w-1/2 space-y-4">
                {loadingDetail ? (<div className="space-y-4"><div className="skeleton h-8 w-3/4 rounded" /><div className="skeleton h-5 w-1/2 rounded" /><div className="card p-4 space-y-3"><div className="skeleton h-6 w-full rounded" /><div className="skeleton h-6 w-full rounded" /><div className="skeleton h-6 w-full rounded" /><div className="skeleton h-6 w-3/4 rounded" /></div></div>)
                : detail ? (<OrderSetDetailPanel orderSet={detail} onClose={() => { setSelectedId(null); setDetail(null); }} onReload={() => { loadDetail(detail.id); loadOrderSets(); }} isAdmin={isAdmin} />)
                : (<div className="card p-8 text-center"><AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" /><p className="text-[var(--color-text-secondary)]">{t('detail.loadFailed')}</p><button onClick={() => selectedId && loadDetail(selectedId)} className="btn-primary mt-3"><RefreshCw className="w-4 h-4" />{t('common:retry')}</button></div>)}
              </div>
            )}
          </div>
        )}
        {showForm && <OrderSetFormModal orderSet={editOrderSet} onClose={() => setShowForm(false)} onSaved={() => { queryClient.invalidateQueries({ queryKey: queryKeys.orderSets.all }); loadOrderSets(); }} />}
      </div>
    </DashboardLayout>
  );
}
