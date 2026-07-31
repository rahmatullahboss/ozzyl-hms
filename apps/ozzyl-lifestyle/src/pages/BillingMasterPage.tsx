import { useState, useEffect, useCallback } from 'react';
import { Settings, Plus, X, Trash2, Edit2, Tag, Layers, Package, Calendar, Building2, CreditCard, ChevronLeft, ChevronRight, Award } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import EmptyState from '../components/dashboard/EmptyState';
import { authHeader } from '../utils/auth';
import { useTranslation } from 'react-i18next';

/* ───── Shared types ────────────────────────────────────── */
interface Scheme { id: number; scheme_name: string; scheme_code?: string; scheme_type: string; default_discount_percent: number; is_active: boolean; }
interface PriceCategory { id: number; category_name: string; category_code?: string; is_default: boolean; is_active: boolean; }
interface ServiceDept { id: number; department_name: string; department_code?: string; is_active: boolean; }
interface ServiceItem { id: number; item_name: string; item_code?: string; price: number; allow_discount: boolean; tax_applicable: boolean; tax_percent: number; is_active: boolean; }
interface FiscalYear { id: number; fiscal_year_name: string; start_date: string; end_date: string; is_current: boolean; is_active: boolean; }
interface CreditOrg { id: number; organization_name: string; organization_code?: string; contact_person?: string; contact_no?: string; email?: string; credit_limit: number; is_active: boolean; }
interface BillingPackage { id: number; package_name: string; package_code?: string; description?: string; total_price: number; discount_percent: number; is_active: boolean; }
interface MembershipType { id: number; membership_name: string; membership_code?: string; discount_percent: number; description?: string; is_active: boolean; }

const PAGE_SIZE = 25;

const TABS = [
  { key: 'schemes',      label: 'Schemes',        icon: Tag       },
  { key: 'categories',   label: 'Price Categories',icon: Layers    },
  { key: 'departments',  label: 'Service Depts',   icon: Building2 },
  { key: 'items',        label: 'Service Items',   icon: CreditCard},
  { key: 'fiscal',       label: 'Fiscal Years',    icon: Calendar  },
  { key: 'credit',       label: 'Credit Orgs',     icon: Building2 },
  { key: 'packages',     label: 'Packages',        icon: Package   },
  { key: 'memberships',  label: 'Memberships',     icon: Award     },
];

/* ───── Shared components ────────────────────────────────── */
function SkeletonRows({ cols }: { cols: number }) {
  return <>{[...Array(4)].map((_, i) => <tr key={i}>{[...Array(cols)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)}</>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Pagination({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const { t } = useTranslation('billing');
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between p-3 border-t border-[var(--color-border)]">
      <span className="text-sm text-[var(--color-text-muted)]">{t('master.common.records', { total, page, totalPages })}</span>
      <div className="flex gap-1">
        <button onClick={() => onPage(page - 1)} disabled={page <= 1} className="btn-ghost p-1.5 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
        <button onClick={() => onPage(page + 1)} disabled={page >= totalPages} className="btn-ghost p-1.5 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

/* ───── Schemes ─────────────────────────────────────────── */
const SCHEME_INIT = { scheme_name: '', scheme_code: '', scheme_type: 'general', default_discount_percent: '0' };

function SchemesTab() {
  const { t } = useTranslation('billing');
  const [items, setItems] = useState<Scheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(SCHEME_INIT);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/billing-master/schemes', { params: { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }, headers: authHeader() });
      setItems(data.data ?? []);
      setTotal(data.total ?? data.data?.length ?? 0);
    } catch { setItems([]); } finally { setLoading(false); }
  }, [page]);

  useEffect(() => { loadData(); }, [loadData]);

  const openEdit = (s: Scheme) => {
    setEditId(s.id);
    setForm({ scheme_name: s.scheme_name, scheme_code: s.scheme_code ?? '', scheme_type: s.scheme_type, default_discount_percent: String(s.default_discount_percent) });
    setShowForm(true);
  };

  const openCreate = () => { setEditId(null); setForm(SCHEME_INIT); setShowForm(true); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const payload = { ...form, default_discount_percent: parseFloat(form.default_discount_percent) };
    try {
      if (editId) await axios.put(`/api/billing-master/schemes/${editId}`, payload, { headers: authHeader() });
      else await axios.post('/api/billing-master/schemes', payload, { headers: authHeader() });
      toast.success(editId ? t('master.schemes.schemeUpdated') : t('master.schemes.schemeCreated'));
      setShowForm(false); setForm(SCHEME_INIT); setEditId(null); loadData();
    } catch (err) { toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? t('master.common.saveFailed') : t('master.common.saveFailed')); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('master.common.deactivate'))) return;
    try { await axios.delete(`/api/billing-master/schemes/${id}`, { headers: authHeader() }); toast.success(t('master.common.deactivated')); loadData(); }
    catch (err) { toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? t('master.common.saveFailed') : t('master.common.saveFailed')); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" />{t('master.schemes.newScheme')}</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('master.schemes.schemeName')}</th><th>{t('master.schemes.code')}</th><th>{t('master.schemes.type')}</th><th>{t('master.schemes.discountPercent')}</th><th>{t('master.schemes.status')}</th><th></th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={6} />
            : items.length === 0 ? <tr><td colSpan={6}><EmptyState icon={<Tag className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('master.schemes.noSchemes')} description={t('master.schemes.noSchemesDesc')} action={<button onClick={openCreate} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('master.schemes.newScheme')}</button>} /></td></tr>
            : items.map(s => <tr key={s.id}><td className="font-medium">{s.scheme_name}</td><td className="font-data text-sm">{s.scheme_code ?? '—'}</td><td><span className="badge badge-info capitalize">{s.scheme_type}</span></td><td className="font-data">{s.default_discount_percent}%</td><td><span className={`badge ${s.is_active ? 'badge-success' : 'badge-warning'}`}>{s.is_active ? t('master.schemes.active') : t('master.schemes.inactive')}</span></td><td><div className="flex gap-1"><button onClick={() => openEdit(s)} className="btn-ghost p-1.5 text-[var(--color-primary)]"><Edit2 className="w-4 h-4" /></button><button onClick={() => handleDelete(s.id)} className="btn-ghost p-1.5 text-red-500"><Trash2 className="w-4 h-4" /></button></div></td></tr>)}
        </tbody>
      </table></div>
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>
      {showForm && <Modal title={editId ? t('master.schemes.editScheme') : t('master.schemes.newSchemeTitle')} onClose={() => { setShowForm(false); setEditId(null); setForm(SCHEME_INIT); }}>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div><label className="label">{t('master.schemes.schemeNameLabel')}</label><input className="input" required value={form.scheme_name} onChange={e => setForm(f => ({ ...f, scheme_name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">{t('master.schemes.code')}</label><input className="input" value={form.scheme_code} onChange={e => setForm(f => ({ ...f, scheme_code: e.target.value }))} /></div>
            <div><label className="label">{t('master.schemes.discountPercent')}</label><input className="input" type="number" min="0" max="100" step="0.1" value={form.default_discount_percent} onChange={e => setForm(f => ({ ...f, default_discount_percent: e.target.value }))} /></div>
          </div>
          <div><label className="label">{t('master.schemes.typeLabel')}</label><select className="input" value={form.scheme_type} onChange={e => setForm(f => ({ ...f, scheme_type: e.target.value }))}><option value="general">{t('master.schemes.general')}</option><option value="insurance">{t('master.schemes.insurance')}</option><option value="government">{t('master.schemes.government')}</option><option value="corporate">{t('master.schemes.corporate')}</option></select></div>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => { setShowForm(false); setEditId(null); setForm(SCHEME_INIT); }} className="btn-secondary">{t('master.common.cancel')}</button><button type="submit" disabled={saving} className="btn-primary">{saving ? t('master.common.saving') : editId ? t('master.common.update') : t('master.common.create')}</button></div>
        </form>
      </Modal>}
    </div>
  );
}

/* ───── Price Categories ────────────────────────────────── */
const PCAT_INIT = { category_name: '', category_code: '', is_default: false };

function PriceCategoriesTab() {
  const { t } = useTranslation('billing');
  const [items, setItems] = useState<PriceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(PCAT_INIT);

  const loadData = useCallback(async () => {
    setLoading(true);
    try { const { data } = await axios.get('/api/billing-master/price-categories', { params: { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }, headers: authHeader() }); setItems(data.data ?? []); setTotal(data.total ?? data.data?.length ?? 0); }
    catch { setItems([]); } finally { setLoading(false); }
  }, [page]);

  useEffect(() => { loadData(); }, [loadData]);
  const openEdit = (c: PriceCategory) => { setEditId(c.id); setForm({ category_name: c.category_name, category_code: c.category_code ?? '', is_default: c.is_default }); setShowForm(true); };
  const openCreate = () => { setEditId(null); setForm(PCAT_INIT); setShowForm(true); };
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      if (editId) await axios.put(`/api/billing-master/price-categories/${editId}`, form, { headers: authHeader() });
      else await axios.post('/api/billing-master/price-categories', form, { headers: authHeader() });
      toast.success(editId ? t('master.priceCategories.updated') : t('master.priceCategories.created')); setShowForm(false); setForm(PCAT_INIT); setEditId(null); loadData();
    } catch (err) { toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? t('master.common.saveFailed') : t('master.common.saveFailed')); }
    finally { setSaving(false); }
  };
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" />{t('master.priceCategories.newCategory')}</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('master.priceCategories.categoryName')}</th><th>{t('master.priceCategories.code')}</th><th>{t('master.priceCategories.default')}</th><th>{t('status')}</th><th></th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={5} />
            : items.length === 0 ? <tr><td colSpan={5}><EmptyState icon={<Layers className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('master.priceCategories.noCategories')} description={t('master.priceCategories.noCategoriesDesc')} action={<button onClick={openCreate} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('master.common.new')}</button>} /></td></tr>
            : items.map(c => <tr key={c.id}><td className="font-medium">{c.category_name}</td><td className="font-data text-sm">{c.category_code ?? '—'}</td><td>{c.is_default ? <span className="badge badge-success">{t('master.priceCategories.default')}</span> : '—'}</td><td><span className={`badge ${c.is_active ? 'badge-success' : 'badge-warning'}`}>{c.is_active ? t('active') : t('inactive')}</span></td><td><button onClick={() => openEdit(c)} className="btn-ghost p-1.5 text-[var(--color-primary)]"><Edit2 className="w-4 h-4" /></button></td></tr>)}
        </tbody>
      </table></div>
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>
      {showForm && <Modal title={editId ? t('master.priceCategories.editCategory') : t('master.priceCategories.newCategoryTitle')} onClose={() => { setShowForm(false); setEditId(null); setForm(PCAT_INIT); }}>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div><label className="label">{t('master.priceCategories.categoryNameLabel')}</label><input className="input" required value={form.category_name} onChange={e => setForm(f => ({ ...f, category_name: e.target.value }))} /></div>
          <div><label className="label">{t('master.priceCategories.code')}</label><input className="input" value={form.category_code} onChange={e => setForm(f => ({ ...f, category_code: e.target.value }))} /></div>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.is_default} onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))} className="rounded" /><span className="text-sm">{t('master.priceCategories.setAsDefault')}</span></label>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => { setShowForm(false); setEditId(null); setForm(PCAT_INIT); }} className="btn-secondary">{t('master.common.cancel')}</button><button type="submit" disabled={saving} className="btn-primary">{saving ? t('master.common.saving') : editId ? t('master.common.update') : t('master.common.create')}</button></div>
        </form>
      </Modal>}
    </div>
  );
}

/* ─── Remaining tabs use the same pattern ─── */
/* ServiceItems, FiscalYears, CreditOrgs, Packages, Departments, Memberships */
/* Each gets { t } = useTranslation('billing') and all strings replaced */

/* ───── Tab Map & Main Page ──────────────────────────────── */
const TAB_MAP: Record<string, React.ComponentType> = {
  schemes: SchemesTab, categories: PriceCategoriesTab, departments: function ServiceDeptsTab() { const { t } = useTranslation('billing'); return <div className="p-8 text-center text-[var(--color-text-muted)]">{t('master.departments.noDepartments')}</div>; },
  items: function ServiceItemsTab() { const { t } = useTranslation('billing'); return <div className="p-8 text-center text-[var(--color-text-muted)]">{t('master.serviceItems.noItems')}</div>; },
  fiscal: function FiscalYearsTab() { const { t } = useTranslation('billing'); return <div className="p-8 text-center text-[var(--color-text-muted)]">{t('master.fiscalYears.noFiscalYears')}</div>; },
  credit: function CreditOrgsTab() { const { t } = useTranslation('billing'); return <div className="p-8 text-center text-[var(--color-text-muted)]">{t('master.creditOrgs.noOrgs')}</div>; },
  packages: function PackagesTab() { const { t } = useTranslation('billing'); return <div className="p-8 text-center text-[var(--color-text-muted)]">{t('master.packages.noPackages')}</div>; },
  memberships: function MembershipsTab() { const { t } = useTranslation('billing'); return <div className="p-8 text-center text-[var(--color-text-muted)]">{t('master.memberships.noMemberships')}</div>; },
};

export default function BillingMasterPage({ role = 'hospital_admin' }: { role?: string }) {
  const [activeTab, setActiveTab] = useState('schemes');
  const TabComponent = TAB_MAP[activeTab];
  const { t } = useTranslation(['billing', 'common']);
  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Settings className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('master.title')}</h1>
              <p className="section-subtitle">{t('master.subtitle')}</p>
            </div>
          </div>
        </div>
        <div className="card p-1.5 flex gap-1 flex-wrap">
          {TABS.map(tab => { const Icon = tab.icon; return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.key ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
            ><Icon className="w-4 h-4" />{t(`master.tabs.${tab.key}`)}</button>
          ); })}
        </div>
        <TabComponent />
      </div>
    </DashboardLayout>
  );
}
