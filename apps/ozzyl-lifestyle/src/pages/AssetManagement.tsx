import { useState, useEffect, useCallback } from 'react';
import {
  Wrench, Plus, X, Search, RefreshCw, AlertTriangle,
  Package, Calendar, MapPin, Building2, Shield, Settings,
  ChevronDown, Eye,
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import { authHeader } from '../utils/auth';

/* ─── Types ───────────────────────────────────────────────── */
interface Asset {
  FixedAssetStockId: number; ItemName?: string; BarCodeNumber?: string;
  asset_category?: string; manufacturer?: string; model_number?: string;
  serial_number?: string; purchase_date?: string; purchase_cost?: number;
  warranty_expiry?: string; current_value?: number; asset_status?: string;
  department?: string; location?: string; last_maintenance_date?: string;
  next_maintenance_due?: string;
}
interface AMC {
  id: number; contract_number: string; vendor_name: string; vendor_contact?: string;
  start_date: string; end_date: string; contract_amount?: number;
  payment_frequency?: string; coverage_type?: string; is_active?: number;
  asset_name?: string;
}
interface MaintenanceLog {
  id: number; maintenance_type: string; description: string;
  performed_by?: string; performed_date: string; next_due_date?: string;
  cost?: number; covered_by_amc?: number; status?: string; asset_name?: string;
}
interface Allocation {
  id: number; department?: string; location?: string; allocated_to?: string;
  allocated_date: string; returned_date?: string;
  condition_on_allocate?: string; condition_on_return?: string; asset_name?: string;
}
interface Stats {
  total: number; active: number; under_repair: number; disposed: number;
  expiring_amc: number; overdue_maintenance: number;
}

/* ─── Constants ───────────────────────────────────────────── */
const STATUS_BADGE: Record<string, string> = {
  active: 'badge-success', under_repair: 'badge-warning', disposed: 'bg-gray-200 text-gray-600',
  condemned: 'bg-red-100 text-red-700', in_storage: 'bg-blue-100 text-blue-700',
};
const MAINT_BADGE: Record<string, string> = {
  preventive: 'bg-blue-100 text-blue-700', corrective: 'bg-amber-100 text-amber-700',
  calibration: 'bg-purple-100 text-purple-700', inspection: 'bg-teal-100 text-teal-700',
  breakdown: 'bg-red-100 text-red-700',
};
const CATEGORIES = ['Medical Equipment', 'Furniture', 'IT Equipment', 'Vehicle', 'Electrical', 'Plumbing', 'Other'];
const TABS = ['assets', 'amc', 'maintenance', 'allocations'] as const;
type Tab = typeof TABS[number];

/* ─── Modal ───────────────────────────────────────────────── */
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

/* ─── Assets Tab ──────────────────────────────────────────── */
function AssetsTab() {
  const { t } = useTranslation(['assetManagement', 'common']);
  const [items, setItems] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ItemId: '', BarCodeNumber: '', asset_category: '', manufacturer: '', model_number: '', serial_number: '', purchase_date: '', purchase_cost: '', warranty_expiry: '', department: '', location: '' });
  const [stats, setStats] = useState<Stats | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (catFilter) params.category = catFilter;
      if (statusFilter) params.status = statusFilter;
      const [res, sRes] = await Promise.all([
        axios.get('/api/inventory/assets', { params, headers: authHeader() }),
        axios.get('/api/inventory/assets/stats', { headers: authHeader() }),
      ]);
      setItems(res.data?.data ?? res.data?.Results ?? []);
      setStats(sRes.data?.data ?? sRes.data ?? null);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [search, catFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/inventory/assets', {
        ...form,
        ItemId: form.ItemId ? Number(form.ItemId) : undefined,
        purchase_cost: form.purchase_cost ? Number(form.purchase_cost) : undefined,
      }, { headers: authHeader() });
      toast.success(t('toast.assetRegistered', { ns: 'assetManagement', defaultValue: 'Asset registered' }));
      setShowForm(false); load();
    } catch { toast.error(t('toast.registerAssetFailed', { ns: 'assetManagement', defaultValue: 'Failed to register asset' })); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Total', val: stats.total, color: '' },
            { label: 'Active', val: stats.active, color: 'text-green-600' },
            { label: 'Under Repair', val: stats.under_repair, color: 'text-amber-600' },
            { label: 'Disposed', val: stats.disposed, color: 'text-gray-500' },
            { label: 'AMC Expiring', val: stats.expiring_amc, color: 'text-red-500' },
            { label: 'Maintenance Due', val: stats.overdue_maintenance, color: 'text-orange-500' },
          ].map(k => (
            <div key={k.label} className="card p-3 text-center">
              <p className="text-xs text-[var(--color-text-muted)] uppercase">{k.label}</p>
              <p className={`text-xl font-bold mt-1 ${k.color}`}>{k.val}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-48">
          <input className="input w-full" placeholder={t("common.search_assets")} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-40" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input w-36" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="under_repair">Under Repair</option>
          <option value="disposed">Disposed</option>
          <option value="in_storage">In Storage</option>
        </select>
        <button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> Register Asset</button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr>
              <th>Asset</th><th>Barcode</th><th>Category</th><th>Manufacturer</th>
              <th>Department</th><th>Location</th><th>Status</th><th>Value</th>
            </tr></thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-[var(--color-text-muted)]">No assets found</td></tr>
              ) : items.map(a => (
                <tr key={a.FixedAssetStockId}>
                  <td className="font-medium">{a.ItemName ?? `Asset #${a.FixedAssetStockId}`}</td>
                  <td className="font-mono text-xs">{a.BarCodeNumber ?? '—'}</td>
                  <td><span className="badge-neutral text-xs">{a.asset_category ?? '—'}</span></td>
                  <td className="text-sm text-[var(--color-text-muted)]">{a.manufacturer ?? '—'}</td>
                  <td className="text-sm">{a.department ?? '—'}</td>
                  <td className="text-sm text-[var(--color-text-muted)]">{a.location ?? '—'}</td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[a.asset_status ?? 'active'] ?? 'badge-neutral'}`}>{(a.asset_status ?? 'active').replace('_', ' ')}</span></td>
                  <td className="font-data text-sm">{a.current_value != null ? `৳${a.current_value.toLocaleString()}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <Modal title="Register Asset" onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('common.barcode')}</label><input className="input w-full" value={form.BarCodeNumber} onChange={e => setForm({...form, BarCodeNumber: e.target.value})} /></div>
              <div><label className="label">{t('common.category')}</label>
                <select className="input w-full" value={form.asset_category} onChange={e => setForm({...form, asset_category: e.target.value})}>
                  <option value="">Select...</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('common.manufacturer')}</label><input className="input w-full" value={form.manufacturer} onChange={e => setForm({...form, manufacturer: e.target.value})} /></div>
              <div><label className="label">{t('common.model')}</label><input className="input w-full" value={form.model_number} onChange={e => setForm({...form, model_number: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('common.serial_number')}</label><input className="input w-full" value={form.serial_number} onChange={e => setForm({...form, serial_number: e.target.value})} /></div>
              <div><label className="label">{t('common.purchase_cost_')}</label><input className="input w-full" type="number" value={form.purchase_cost} onChange={e => setForm({...form, purchase_cost: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('common.purchase_date')}</label><input className="input w-full" type="date" value={form.purchase_date} onChange={e => setForm({...form, purchase_date: e.target.value})} /></div>
              <div><label className="label">{t('common.warranty_expiry')}</label><input className="input w-full" type="date" value={form.warranty_expiry} onChange={e => setForm({...form, warranty_expiry: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('common.department')}</label><input className="input w-full" value={form.department} onChange={e => setForm({...form, department: e.target.value})} /></div>
              <div><label className="label">Location</label><input className="input w-full" value={form.location} onChange={e => setForm({...form, location: e.target.value})} placeholder={t("common.eg_icu_room_3")} /></div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Register'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ─── AMC Tab ─────────────────────────────────────────────── */
function AMCTab() {
  const { t } = useTranslation(['assetManagement', 'common']);
  const [items, setItems] = useState<AMC[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ asset_stock_id: '', contract_number: '', vendor_name: '', vendor_contact: '', start_date: '', end_date: '', contract_amount: '', payment_frequency: 'annual', coverage_type: 'comprehensive', terms: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/inventory/assets/amc', { headers: authHeader() });
      setItems(data?.data ?? data?.Results ?? []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const expiringSoon = items.filter(a => {
    if (!a.end_date) return false;
    const diff = (new Date(a.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 30;
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/inventory/assets/amc', {
        ...form,
        asset_stock_id: form.asset_stock_id ? Number(form.asset_stock_id) : undefined,
        contract_amount: form.contract_amount ? Number(form.contract_amount) : undefined,
      }, { headers: authHeader() });
      toast.success(t('toast.amcCreated', { ns: 'assetManagement', defaultValue: 'AMC contract created' }));
      setShowForm(false); load();
    } catch { toast.error(t('toast.createAmcFailed', { ns: 'assetManagement', defaultValue: 'Failed to create contract' })); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      {expiringSoon.length > 0 && (
        <div className="card p-4 border-l-4 border-l-amber-400 bg-amber-50 dark:bg-amber-950/20">
          <div className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="w-4 h-4" />
            <p className="text-sm font-medium">{expiringSoon.length} AMC contract(s) expiring within 30 days</p>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> New AMC</button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Contract #</th><th>Vendor</th><th>Start</th><th>End</th><th>Amount</th><th>Coverage</th><th>Status</th></tr></thead>
            <tbody>
              {loading ? (
                [...Array(3)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-[var(--color-text-muted)]">No AMC contracts</td></tr>
              ) : items.map(a => {
                const expired = new Date(a.end_date) < new Date();
                return (
                  <tr key={a.id}>
                    <td className="font-mono text-sm font-medium">{a.contract_number}</td>
                    <td>{a.vendor_name}</td>
                    <td className="text-sm">{a.start_date?.slice(0, 10)}</td>
                    <td className="text-sm">{a.end_date?.slice(0, 10)}</td>
                    <td className="font-data">{a.contract_amount ? `৳${a.contract_amount.toLocaleString()}` : '—'}</td>
                    <td><span className="badge-neutral text-xs">{a.coverage_type ?? '—'}</span></td>
                    <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${expired ? 'bg-red-100 text-red-700' : 'badge-success'}`}>{expired ? 'Expired' : 'Active'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <Modal title="New AMC Contract" onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="label">{t('common.contract_number_')}</label><input className="input w-full" required value={form.contract_number} onChange={e => setForm({...form, contract_number: e.target.value})} /></div>
            <div><label className="label">{t('common.vendor_name_')}</label><input className="input w-full" required value={form.vendor_name} onChange={e => setForm({...form, vendor_name: e.target.value})} /></div>
            <div><label className="label">{t('common.vendor_contact')}</label><input className="input w-full" value={form.vendor_contact} onChange={e => setForm({...form, vendor_contact: e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('common.start_date_')}</label><input className="input w-full" type="date" required value={form.start_date} onChange={e => setForm({...form, start_date: e.target.value})} /></div>
              <div><label className="label">{t('common.end_date_')}</label><input className="input w-full" type="date" required value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('common.amount_')}</label><input className="input w-full" type="number" value={form.contract_amount} onChange={e => setForm({...form, contract_amount: e.target.value})} /></div>
              <div><label className="label">{t('common.coverage')}</label>
                <select className="input w-full" value={form.coverage_type} onChange={e => setForm({...form, coverage_type: e.target.value})}>
                  <option value="comprehensive">Comprehensive</option>
                  <option value="non_comprehensive">Non-Comprehensive</option>
                  <option value="labor_only">Labor Only</option>
                  <option value="parts_only">Parts Only</option>
                </select>
              </div>
            </div>
            <div><label className="label">{t('common.terms_notes')}</label><textarea className="input w-full" rows={2} value={form.terms} onChange={e => setForm({...form, terms: e.target.value})} /></div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Create'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ─── Maintenance Tab ─────────────────────────────────────── */
function MaintenanceTab() {
  const { t } = useTranslation(['assetManagement', 'common']);
  const [items, setItems] = useState<MaintenanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [form, setForm] = useState({ asset_stock_id: '', maintenance_type: 'preventive', description: '', performed_by: '', performed_date: new Date().toISOString().slice(0, 10), next_due_date: '', cost: '', covered_by_amc: false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (typeFilter) params.type = typeFilter;
      const { data } = await axios.get('/api/inventory/assets/maintenance', { params, headers: authHeader() });
      setItems(data?.data ?? data?.Results ?? []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [typeFilter]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/inventory/assets/maintenance', {
        ...form,
        asset_stock_id: Number(form.asset_stock_id),
        cost: form.cost ? Number(form.cost) : undefined,
        covered_by_amc: form.covered_by_amc ? 1 : 0,
      }, { headers: authHeader() });
      toast.success(t('toast.maintenanceLogged', { ns: 'assetManagement', defaultValue: 'Maintenance logged' }));
      setShowForm(false); load();
    } catch { toast.error(t('toast.logMaintenanceFailed', { ns: 'assetManagement', defaultValue: 'Failed to log maintenance' })); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-end">
        <select className="input w-40" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All Types</option>
          <option value="preventive">Preventive</option>
          <option value="corrective">Corrective</option>
          <option value="calibration">Calibration</option>
          <option value="breakdown">Breakdown</option>
        </select>
        <button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> Log Maintenance</button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Date</th><th>Asset</th><th>Type</th><th>Description</th><th>By</th><th>Cost</th><th>AMC?</th><th>Next Due</th></tr></thead>
            <tbody>
              {loading ? (
                [...Array(3)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-[var(--color-text-muted)]">No maintenance records</td></tr>
              ) : items.map(m => (
                <tr key={m.id}>
                  <td className="text-sm">{m.performed_date?.slice(0, 10)}</td>
                  <td className="font-medium">{m.asset_name ?? `#${m.id}`}</td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${MAINT_BADGE[m.maintenance_type] ?? 'badge-neutral'}`}>{m.maintenance_type}</span></td>
                  <td className="text-sm max-w-48 truncate">{m.description}</td>
                  <td className="text-sm text-[var(--color-text-muted)]">{m.performed_by ?? '—'}</td>
                  <td className="font-data text-sm">{m.cost ? `৳${m.cost.toLocaleString()}` : '—'}</td>
                  <td>{m.covered_by_amc ? <span className="badge-success text-xs">Yes</span> : '—'}</td>
                  <td className="text-sm text-[var(--color-text-muted)]">{m.next_due_date?.slice(0, 10) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <Modal title="Log Maintenance" onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="label">{t('common.asset_id_')}</label><input className="input w-full" required type="number" value={form.asset_stock_id} onChange={e => setForm({...form, asset_stock_id: e.target.value})} /></div>
            <div><label className="label">{t('common.type')}</label>
              <select className="input w-full" value={form.maintenance_type} onChange={e => setForm({...form, maintenance_type: e.target.value})}>
                <option value="preventive">Preventive</option>
                <option value="corrective">Corrective</option>
                <option value="calibration">Calibration</option>
                <option value="inspection">Inspection</option>
                <option value="breakdown">Breakdown</option>
              </select>
            </div>
            <div><label className="label">{t('common.description_')}</label><textarea className="input w-full" required rows={2} value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('common.performed_by')}</label><input className="input w-full" value={form.performed_by} onChange={e => setForm({...form, performed_by: e.target.value})} /></div>
              <div><label className="label">{t('common.date_')}</label><input className="input w-full" type="date" required value={form.performed_date} onChange={e => setForm({...form, performed_date: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('common.cost_')}</label><input className="input w-full" type="number" value={form.cost} onChange={e => setForm({...form, cost: e.target.value})} /></div>
              <div><label className="label">{t('common.next_due_date')}</label><input className="input w-full" type="date" value={form.next_due_date} onChange={e => setForm({...form, next_due_date: e.target.value})} /></div>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.covered_by_amc} onChange={e => setForm({...form, covered_by_amc: e.target.checked})} />
              <span className="text-sm">Covered by AMC</span>
            </label>
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

/* ─── Allocations Tab ─────────────────────────────────────── */
function AllocationsTab() {
  const { t } = useTranslation(['assetManagement', 'common']);
  const [items, setItems] = useState<Allocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ asset_stock_id: '', department: '', location: '', allocated_to: '', allocated_date: new Date().toISOString().slice(0, 10), condition_on_allocate: 'good' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/inventory/assets/allocate', { headers: authHeader() }).catch(() => ({ data: { data: [] } }));
      setItems(data?.data ?? data?.Results ?? []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/inventory/assets/allocate', {
        ...form, asset_stock_id: Number(form.asset_stock_id),
      }, { headers: authHeader() });
      toast.success(t('toast.assetAllocated', { ns: 'assetManagement', defaultValue: 'Asset allocated' }));
      setShowForm(false); load();
    } catch { toast.error(t('toast.allocFailed', { ns: 'assetManagement', defaultValue: 'Failed' })); }
    finally { setSaving(false); }
  };

  const handleReturn = async (id: number) => {
    try {
      await axios.put(`/api/inventory/assets/allocate/${id}/return`, {
        returned_date: new Date().toISOString().split('T')[0],
        condition_on_return: 'good',
      }, { headers: authHeader() });
      toast.success(t('toast.assetReturned', { ns: 'assetManagement', defaultValue: 'Asset returned' }));
      load();
    } catch { toast.error(t('toast.returnAssetFailed', { ns: 'assetManagement', defaultValue: 'Failed' })); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> Allocate Asset</button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Asset</th><th>Department</th><th>Location</th><th>Allocated To</th><th>Date</th><th>Condition</th><th>Returned</th><th></th></tr></thead>
            <tbody>
              {loading ? (
                [...Array(3)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-[var(--color-text-muted)]">No allocations</td></tr>
              ) : items.map(a => (
                <tr key={a.id}>
                  <td className="font-medium">{a.asset_name ?? `#${a.id}`}</td>
                  <td>{a.department ?? '—'}</td>
                  <td className="text-sm text-[var(--color-text-muted)]">{a.location ?? '—'}</td>
                  <td>{a.allocated_to ?? '—'}</td>
                  <td className="text-sm">{a.allocated_date?.slice(0, 10)}</td>
                  <td><span className="badge-neutral text-xs">{a.condition_on_allocate ?? '—'}</span></td>
                  <td>{a.returned_date ? <span className="badge-success text-xs">{a.returned_date.slice(0, 10)}</span> : <span className="badge-warning text-xs">In Use</span>}</td>
                  <td>{!a.returned_date && <button onClick={() => handleReturn(a.id)} className="text-xs text-[var(--color-primary)] hover:underline">Return</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <Modal title="Allocate Asset" onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="label">{t('common.asset_id_')}</label><input className="input w-full" required type="number" value={form.asset_stock_id} onChange={e => setForm({...form, asset_stock_id: e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('common.department')}</label><input className="input w-full" value={form.department} onChange={e => setForm({...form, department: e.target.value})} /></div>
              <div><label className="label">{t('common.location')}</label><input className="input w-full" value={form.location} onChange={e => setForm({...form, location: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('common.allocated_to')}</label><input className="input w-full" value={form.allocated_to} onChange={e => setForm({...form, allocated_to: e.target.value})} /></div>
              <div><label className="label">{t('common.date')}</label><input className="input w-full" type="date" value={form.allocated_date} onChange={e => setForm({...form, allocated_date: e.target.value})} /></div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Allocate'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ─── Tab Map ─────────────────────────────────────────────── */
const TAB_MAP: Record<Tab, { label: string; icon: typeof Package; component: React.ComponentType }> = {
  assets: { label: 'Assets', icon: Package, component: AssetsTab },
  amc: { label: 'AMC Contracts', icon: Shield, component: AMCTab },
  maintenance: { label: 'Maintenance', icon: Settings, component: MaintenanceTab },
  allocations: { label: 'Allocations', icon: MapPin, component: AllocationsTab },
};

/* ─── Main Page ───────────────────────────────────────────── */
export default function AssetManagement({ role }: { role?: string }) {
  const { t } = useTranslation(['assetManagement', 'common']);
  const [tab, setTab] = useState<Tab>('assets');
  const TabContent = TAB_MAP[tab].component;

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Wrench className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">Asset Management</h1>
              <p className="section-subtitle">Equipment tracking, AMC contracts & maintenance</p>
            </div>
          </div>
        </div>

        <div className="card p-1.5 flex gap-1 flex-wrap">
          {TABS.map(t => {
            const info = TAB_MAP[t];
            const Icon = info.icon;
            return (
              <button key={t} onClick={() => setTab(t)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === t ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'
                }`}>
                <Icon className="w-4 h-4" />{info.label}
              </button>
            );
          })}
        </div>

        <TabContent />
      </div>
    </DashboardLayout>
  );
}
