import { useEffect, useState } from 'react';
import {
  Wrench, Plus, X, Search, RefreshCw, AlertTriangle,
  Package, Calendar, MapPin, Building2, Shield, Settings,
  ChevronDown, Eye, QrCode, FileText, TrendingDown, Trash2, Download,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { api } from '../lib/apiClient';
import DOMPurify from 'dompurify';

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
interface InsurancePolicy {
  id: number; asset_stock_id: number; policy_number: string; insurer_name: string;
  insured_value: number; premium_amount?: number; start_date: string; end_date: string;
  file_key?: string; file_name?: string; remarks?: string; status: string;
}
interface ContractDocument {
  id: number; asset_stock_id: number; contract_type: string; contract_number?: string;
  vendor_name?: string; file_key: string; file_name?: string; file_size?: number;
  mime_type?: string; effective_from?: string; effective_to?: string; is_active: number;
}

/* ─── API response wrappers ──────────────────────────────── */
interface AssetsResponse { data?: Asset[]; Results?: Asset[]; }
interface StatsResponse { data?: Stats; }
interface AMCResponse { data?: AMC[]; Results?: AMC[]; }
interface MaintenanceResponse { data?: MaintenanceLog[]; Results?: MaintenanceLog[]; }
interface AllocationsResponse { data?: Allocation[]; Results?: Allocation[]; }
interface InsuranceResponse { data?: InsurancePolicy[]; }
interface ContractsResponse { data?: ContractDocument[]; }

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
const TABS = ['assets', 'amc', 'maintenance', 'allocations', 'insurance', 'contracts', 'reports'] as const;
type Tab = typeof TABS[number];
const INSURANCE_STATUS_BADGE: Record<string, string> = {
  active: 'badge-success', expired: 'bg-red-100 text-red-700', cancelled: 'bg-gray-200 text-gray-600',
};
const DISPOSAL_TYPES = ['scrap', 'sold', 'lost', 'donated', 'condemned'] as const;
const DEPRECIATION_METHODS = ['straight_line', 'declining_balance', 'manual'] as const;

/* ─── Path builders ──────────────────────────────────────── */
function buildAssetsPath(search: string, category: string, status: string): string {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (category) params.set('category', category);
  if (status) params.set('status', status);
  const qs = params.toString();
  return `/api/inventory/assets${qs ? `?${qs}` : ''}`;
}

function buildMaintenancePath(typeFilter: string): string {
  const params = new URLSearchParams();
  if (typeFilter) params.set('type', typeFilter);
  const qs = params.toString();
  return `/api/inventory/assets/maintenance${qs ? `?${qs}` : ''}`;
}

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
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [qrPreview, setQrPreview] = useState<{ tagCode: string; svg?: string } | null>(null);
  const [showDepreciation, setShowDepreciation] = useState<Asset | null>(null);
  const [showDisposal, setShowDisposal] = useState<Asset | null>(null);
  const [form, setForm] = useState({ ItemId: '', BarCodeNumber: '', asset_category: '', manufacturer: '', model_number: '', serial_number: '', purchase_date: '', purchase_cost: '', warranty_expiry: '', department: '', location: '' });
  const [depForm, setDepForm] = useState({ depreciation_method: 'straight_line', depreciation_date: new Date().toISOString().slice(0, 10), depreciation_amount: '', depreciation_rate: '', fiscal_year: '', remarks: '' });
  const [dispForm, setDispForm] = useState({ disposal_date: new Date().toISOString().slice(0, 10), disposal_type: 'scrap', reason: '', disposal_value: '', remarks: '' });

  /* ─── Queries ──────────────────────────────────────────── */
  const assetsFilters = { search, category: catFilter, status: statusFilter };

  const assetsQuery = useApiQuery<AssetsResponse>(
    queryKeys.assets.list(assetsFilters),
    buildAssetsPath(search, catFilter, statusFilter),
  );

  const statsQuery = useApiQuery<StatsResponse>(
    queryKeys.assets.stats(),
    '/api/inventory/assets/stats',
  );

  const items = assetsQuery.data?.data ?? assetsQuery.data?.Results ?? [];
  const stats = statsQuery.data?.data ?? null;
  const loading = assetsQuery.isLoading;

  /* ─── Mutations ────────────────────────────────────────── */
  const invalidateAssets = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.assets.all });

  const registerAssetMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/inventory/assets',
    {
      onSuccess: () => {
        toast.success(t('toast.assetRegistered', { ns: 'assetManagement', defaultValue: 'Asset registered' }));
        setShowForm(false);
        invalidateAssets();
      },
      onError: () => {
        toast.error(t('toast.registerAssetFailed', { ns: 'assetManagement', defaultValue: 'Failed to register asset' }));
      },
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    registerAssetMutation.mutate({
      ...form,
      ItemId: form.ItemId ? Number(form.ItemId) : undefined,
      purchase_cost: form.purchase_cost ? Number(form.purchase_cost) : undefined,
    });
  };

  const saving = registerAssetMutation.isPending;

  const showAssetQr = async (asset: Asset) => {
    const payload = await api.get<{ tagCode: string }>(`/api/inventory/assets/${asset.FixedAssetStockId}/qr`);
    const printed = await api.post<{ tagCode: string; svg: string }>(`/api/inventory/qr/${payload.tagCode}/print`, {});
    setQrPreview(printed);
  };

  const depreciateMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    `/api/inventory/assets/${showDepreciation?.FixedAssetStockId}/depreciation`,
    {
      onSuccess: () => {
        toast.success('Depreciation recorded');
        setShowDepreciation(null);
        invalidateAssets();
      },
      onError: () => toast.error('Failed to record depreciation'),
    },
  );

  const disposeMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    `/api/inventory/assets/${showDisposal?.FixedAssetStockId}/dispose`,
    {
      onSuccess: () => {
        toast.success('Asset disposed');
        setShowDisposal(null);
        invalidateAssets();
      },
      onError: () => toast.error('Failed to dispose asset'),
    },
  );

  const handleDepreciate = (e: React.FormEvent) => {
    e.preventDefault();
    depreciateMutation.mutate({
      depreciation_method: depForm.depreciation_method,
      depreciation_date: depForm.depreciation_date,
      depreciation_amount: Number(depForm.depreciation_amount),
      depreciation_rate: depForm.depreciation_rate ? Number(depForm.depreciation_rate) : undefined,
      fiscal_year: depForm.fiscal_year || undefined,
      remarks: depForm.remarks || undefined,
    });
  };

  const handleDispose = (e: React.FormEvent) => {
    e.preventDefault();
    disposeMutation.mutate({
      disposal_date: dispForm.disposal_date,
      disposal_type: dispForm.disposal_type,
      reason: dispForm.reason,
      disposal_value: dispForm.disposal_value ? Number(dispForm.disposal_value) : undefined,
      remarks: dispForm.remarks || undefined,
    });
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
          <input className="input w-full" placeholder={t('search_assets', { ns: 'common' })} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
          <select className="input w-40" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
            <option value="">{t('allCategories')}</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
          <select className="input w-36" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">{t('allStatus')}</option>
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
              <th>Department</th><th>Location</th><th>Status</th><th>Value</th><th></th>
            </tr></thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => <tr key={i}>{[...Array(9)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              ) : items.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-[var(--color-text-muted)]">No assets found</td></tr>
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
                  <td>
                    <div className="flex items-center gap-1">
                      <button type="button" className="btn-ghost p-1.5" onClick={() => showAssetQr(a)} title="QR"><QrCode className="w-4 h-4" /></button>
                      {a.asset_status !== 'disposed' && a.asset_status !== 'condemned' && (
                        <>
                          <button type="button" className="btn-ghost p-1.5" onClick={() => setShowDepreciation(a)} title="Depreciation"><TrendingDown className="w-4 h-4" /></button>
                          <button type="button" className="btn-ghost p-1.5" onClick={() => setShowDisposal(a)} title="Dispose"><Trash2 className="w-4 h-4" /></button>
                        </>
                      )}
                    </div>
                  </td>
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
      {qrPreview && (
        <Modal title="Asset QR" onClose={() => setQrPreview(null)}>
          <div className="text-center space-y-3">
            {qrPreview.svg && <div className="mx-auto w-52" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(qrPreview.svg, { USE_PROFILES: { svg: true } }) }} />}
            <p className="font-mono text-xs break-all">{qrPreview.tagCode}</p>
          </div>
        </Modal>
      )}
      {showDepreciation && (
        <Modal title={`Depreciate — ${showDepreciation.ItemName ?? `Asset #${showDepreciation.FixedAssetStockId}`}`} onClose={() => setShowDepreciation(null)}>
          <form onSubmit={handleDepreciate} className="space-y-3">
            <div className="card p-3 bg-[var(--color-bg-muted)] text-sm">
              <p>Current Value: <span className="font-data font-medium">৳{(showDepreciation.current_value ?? showDepreciation.purchase_cost ?? 0).toLocaleString()}</span></p>
            </div>
            <div><label className="label">Method</label>
              <select className="input w-full" value={depForm.depreciation_method} onChange={e => setDepForm({...depForm, depreciation_method: e.target.value})}>
                {DEPRECIATION_METHODS.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Date *</label><input className="input w-full" type="date" required value={depForm.depreciation_date} onChange={e => setDepForm({...depForm, depreciation_date: e.target.value})} /></div>
              <div><label className="label">Amount *</label><input className="input w-full" type="number" required value={depForm.depreciation_amount} onChange={e => setDepForm({...depForm, depreciation_amount: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Rate %</label><input className="input w-full" type="number" value={depForm.depreciation_rate} onChange={e => setDepForm({...depForm, depreciation_rate: e.target.value})} placeholder="e.g. 25" /></div>
              <div><label className="label">Fiscal Year</label><input className="input w-full" value={depForm.fiscal_year} onChange={e => setDepForm({...depForm, fiscal_year: e.target.value})} placeholder="e.g. 2025" /></div>
            </div>
            <div><label className="label">Remarks</label><textarea className="input w-full" rows={2} value={depForm.remarks} onChange={e => setDepForm({...depForm, remarks: e.target.value})} /></div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowDepreciation(null)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={depreciateMutation.isPending} className="btn-primary">{depreciateMutation.isPending ? 'Recording...' : 'Record Depreciation'}</button>
            </div>
          </form>
        </Modal>
      )}
      {showDisposal && (
        <Modal title={`Dispose — ${showDisposal.ItemName ?? `Asset #${showDisposal.FixedAssetStockId}`}`} onClose={() => setShowDisposal(null)}>
          <form onSubmit={handleDispose} className="space-y-3">
            <div className="card p-3 bg-red-50 dark:bg-red-950/20 text-sm text-red-700">
              <p>This action will mark the asset as disposed and cannot be easily reversed.</p>
            </div>
            <div><label className="label">Disposal Type *</label>
              <select className="input w-full" value={dispForm.disposal_type} onChange={e => setDispForm({...dispForm, disposal_type: e.target.value})}>
                {DISPOSAL_TYPES.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Date *</label><input className="input w-full" type="date" required value={dispForm.disposal_date} onChange={e => setDispForm({...dispForm, disposal_date: e.target.value})} /></div>
              <div><label className="label">Disposal Value</label><input className="input w-full" type="number" value={dispForm.disposal_value} onChange={e => setDispForm({...dispForm, disposal_value: e.target.value})} /></div>
            </div>
            <div><label className="label">Reason *</label><textarea className="input w-full" required rows={2} value={dispForm.reason} onChange={e => setDispForm({...dispForm, reason: e.target.value})} /></div>
            <div><label className="label">Remarks</label><textarea className="input w-full" rows={2} value={dispForm.remarks} onChange={e => setDispForm({...dispForm, remarks: e.target.value})} /></div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowDisposal(null)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={disposeMutation.isPending} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium disabled:opacity-50">{disposeMutation.isPending ? 'Disposing...' : 'Dispose Asset'}</button>
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
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ asset_stock_id: '', contract_number: '', vendor_name: '', vendor_contact: '', start_date: '', end_date: '', contract_amount: '', payment_frequency: 'annual', coverage_type: 'comprehensive', terms: '' });

  /* ─── Queries ──────────────────────────────────────────── */
  const amcQuery = useApiQuery<AMCResponse>(
    queryKeys.assets.amc(),
    '/api/inventory/assets/amc',
  );

  const items = amcQuery.data?.data ?? amcQuery.data?.Results ?? [];
  const loading = amcQuery.isLoading;

  const expiringSoon = items.filter(a => {
    if (!a.end_date) return false;
    const diff = (new Date(a.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 30;
  });

  /* ─── Mutations ────────────────────────────────────────── */
  const invalidateAssets = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.assets.all });

  const createAmcMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/inventory/assets/amc',
    {
      onSuccess: () => {
        toast.success(t('toast.amcCreated', { ns: 'assetManagement', defaultValue: 'AMC contract created' }));
        setShowForm(false);
        invalidateAssets();
      },
      onError: () => {
        toast.error(t('toast.createAmcFailed', { ns: 'assetManagement', defaultValue: 'Failed to create contract' }));
      },
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createAmcMutation.mutate({
      ...form,
      asset_stock_id: form.asset_stock_id ? Number(form.asset_stock_id) : undefined,
      contract_amount: form.contract_amount ? Number(form.contract_amount) : undefined,
    });
  };

  const saving = createAmcMutation.isPending;

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
function MaintenanceTab({ focusLogId }: { focusLogId?: number }) {
  const { t } = useTranslation(['assetManagement', 'common']);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [form, setForm] = useState({ asset_stock_id: '', maintenance_type: 'preventive', description: '', performed_by: '', performed_date: new Date().toISOString().slice(0, 10), next_due_date: '', cost: '', covered_by_amc: false });

  /* ─── Queries ──────────────────────────────────────────── */
  const maintenanceFilters = { type: typeFilter };

  const maintenanceQuery = useApiQuery<MaintenanceResponse>(
    queryKeys.assets.maintenance(maintenanceFilters),
    buildMaintenancePath(typeFilter),
  );

  const items = maintenanceQuery.data?.data ?? maintenanceQuery.data?.Results ?? [];
  const loading = maintenanceQuery.isLoading;

  useEffect(() => {
    if (!focusLogId || loading || items.length === 0) return;
    const timeout = window.setTimeout(() => {
      const row = document.getElementById(`maintenance-log-${focusLogId}`);
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [focusLogId, loading, items.length]);

  /* ─── Mutations ────────────────────────────────────────── */
  const invalidateAssets = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.assets.all });

  const logMaintenanceMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/inventory/assets/maintenance',
    {
      onSuccess: () => {
        toast.success(t('toast.maintenanceLogged', { ns: 'assetManagement', defaultValue: 'Maintenance logged' }));
        setShowForm(false);
        invalidateAssets();
      },
      onError: () => {
        toast.error(t('toast.logMaintenanceFailed', { ns: 'assetManagement', defaultValue: 'Failed to log maintenance' }));
      },
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    logMaintenanceMutation.mutate({
      ...form,
      asset_stock_id: Number(form.asset_stock_id),
      cost: form.cost ? Number(form.cost) : undefined,
      covered_by_amc: form.covered_by_amc ? 1 : 0,
    });
  };

  const saving = logMaintenanceMutation.isPending;

  const focusedLog = focusLogId ? items.find(item => item.id === focusLogId) : undefined;

  return (
    <div className="space-y-4">
      {focusLogId && (
        <div className={`rounded-xl border p-3 text-sm ${focusedLog ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
          {focusedLog
            ? <>Focused maintenance log #{focusLogId}: <span className="font-semibold">{focusedLog.asset_name ?? focusedLog.description}</span></>
            : <>Looking for maintenance log #{focusLogId}. It may be filtered out or not loaded yet.</>}
        </div>
      )}
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
                <tr
                  key={m.id}
                  id={`maintenance-log-${m.id}`}
                  className={focusLogId === m.id ? 'bg-amber-50 ring-2 ring-amber-300 scroll-mt-24' : undefined}
                >
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
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ asset_stock_id: '', department: '', location: '', allocated_to: '', allocated_date: new Date().toISOString().slice(0, 10), condition_on_allocate: 'good' });

  /* ─── Queries ──────────────────────────────────────────── */
  const allocationsQuery = useApiQuery<AllocationsResponse>(
    queryKeys.assets.allocations(),
    '/api/inventory/assets/allocate',
  );

  const items = allocationsQuery.data?.data ?? allocationsQuery.data?.Results ?? [];
  const loading = allocationsQuery.isLoading;

  /* ─── Mutations ────────────────────────────────────────── */
  const invalidateAssets = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.assets.all });

  const allocateAssetMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/inventory/assets/allocate',
    {
      onSuccess: () => {
        toast.success(t('toast.assetAllocated', { ns: 'assetManagement', defaultValue: 'Asset allocated' }));
        setShowForm(false);
        invalidateAssets();
      },
      onError: () => {
        toast.error(t('toast.allocFailed', { ns: 'assetManagement', defaultValue: 'Failed' }));
      },
    },
  );

  const returnAssetMutation = useApiMutation<unknown, { id: number; returned_date: string; condition_on_return: string }>(
    'put',
    (vars) => `/api/inventory/assets/allocate/${vars.id}/return`,
    {
      onSuccess: () => {
        toast.success(t('toast.assetReturned', { ns: 'assetManagement', defaultValue: 'Asset returned' }));
        invalidateAssets();
      },
      onError: () => {
        toast.error(t('toast.returnAssetFailed', { ns: 'assetManagement', defaultValue: 'Failed' }));
      },
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    allocateAssetMutation.mutate({
      ...form, asset_stock_id: Number(form.asset_stock_id),
    });
  };

  const handleReturn = (id: number) => {
    returnAssetMutation.mutate({
      id,
      returned_date: new Date().toISOString().split('T')[0],
      condition_on_return: 'good',
    });
  };

  const saving = allocateAssetMutation.isPending;

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

/* ─── Insurance Tab ──────────────────────────────────────────── */
function InsuranceTab() {
  const { t } = useTranslation(['assetManagement', 'common']);
  const queryClient = useQueryClient();
  const [assetId, setAssetId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editPolicy, setEditPolicy] = useState<InsurancePolicy | null>(null);
  const [form, setForm] = useState({
    asset_stock_id: '', policy_number: '', insurer_name: '', insured_value: '',
    premium_amount: '', start_date: '', end_date: '', remarks: '', status: 'active',
  });

  const insuranceQuery = useApiQuery<InsuranceResponse>(
    queryKeys.assets.list({ type: 'insurance', assetId }),
    assetId ? `/api/inventory/assets/${assetId}/insurance` : '',
    { enabled: !!assetId },
  );

  const items = insuranceQuery.data?.data ?? [];
  const loading = insuranceQuery.isLoading;

  const invalidateAssets = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.assets.all });

  const createMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    `/api/inventory/assets/${form.asset_stock_id}/insurance`,
    {
      onSuccess: () => {
        toast.success('Insurance policy created');
        setShowForm(false);
        invalidateAssets();
      },
      onError: () => toast.error('Failed to create insurance policy'),
    },
  );

  const updateMutation = useApiMutation<unknown, Record<string, unknown>>(
    'put',
    `/api/inventory/assets/insurance/${editPolicy?.id}`,
    {
      onSuccess: () => {
        toast.success('Insurance policy updated');
        setEditPolicy(null);
        invalidateAssets();
      },
      onError: () => toast.error('Failed to update insurance policy'),
    },
  );

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      ...form,
      insured_value: Number(form.insured_value),
      premium_amount: form.premium_amount ? Number(form.premium_amount) : undefined,
    });
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editPolicy) return;
    updateMutation.mutate({
      policy_number: editPolicy.policy_number,
      insurer_name: editPolicy.insurer_name,
      insured_value: Number(editPolicy.insured_value),
      premium_amount: editPolicy.premium_amount ? Number(editPolicy.premium_amount) : undefined,
      start_date: editPolicy.start_date?.slice(0, 10),
      end_date: editPolicy.end_date?.slice(0, 10),
      status: editPolicy.status,
      remarks: editPolicy.remarks,
    });
  };

  const isExpiring = (end: string) => {
    const diff = (new Date(end).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 30;
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end">
        <div className="flex-1 min-w-48">
          <label className="label">Asset ID</label>
          <input className="input w-full" type="number" placeholder="Enter asset ID to view policies" value={assetId} onChange={e => setAssetId(e.target.value)} />
        </div>
        <button onClick={() => { setForm({ ...form, asset_stock_id: assetId }); setShowForm(true); }} className="btn-primary" disabled={!assetId}><Plus className="w-4 h-4" /> Add Policy</button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Policy #</th><th>Insurer</th><th>Insured Value</th><th>Premium</th><th>Start</th><th>End</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {!assetId ? (
                <tr><td colSpan={8} className="text-center py-8 text-[var(--color-text-muted)]">Enter an asset ID to view insurance policies</td></tr>
              ) : loading ? (
                [...Array(3)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-[var(--color-text-muted)]">No insurance policies</td></tr>
              ) : items.map(p => (
                <tr key={p.id}>
                  <td className="font-mono text-sm font-medium">{p.policy_number}</td>
                  <td>{p.insurer_name}</td>
                  <td className="font-data">{p.insured_value ? `৳${p.insured_value.toLocaleString()}` : '—'}</td>
                  <td className="font-data text-sm">{p.premium_amount ? `৳${p.premium_amount.toLocaleString()}` : '—'}</td>
                  <td className="text-sm">{p.start_date?.slice(0, 10)}</td>
                  <td className="text-sm">{p.end_date?.slice(0, 10)}</td>
                  <td>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${INSURANCE_STATUS_BADGE[p.status] ?? 'badge-neutral'}`}>{p.status}</span>
                    {isExpiring(p.end_date) && <span className="ml-1 text-xs text-amber-600">Expiring soon</span>}
                  </td>
                  <td><button onClick={() => setEditPolicy(p)} className="text-xs text-[var(--color-primary)] hover:underline">Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <Modal title="Add Insurance Policy" onClose={() => setShowForm(false)}>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><label className="label">Policy Number *</label><input className="input w-full" required value={form.policy_number} onChange={e => setForm({...form, policy_number: e.target.value})} /></div>
            <div><label className="label">Insurer Name *</label><input className="input w-full" required value={form.insurer_name} onChange={e => setForm({...form, insurer_name: e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Insured Value</label><input className="input w-full" type="number" value={form.insured_value} onChange={e => setForm({...form, insured_value: e.target.value})} /></div>
              <div><label className="label">Premium Amount</label><input className="input w-full" type="number" value={form.premium_amount} onChange={e => setForm({...form, premium_amount: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Start Date *</label><input className="input w-full" type="date" required value={form.start_date} onChange={e => setForm({...form, start_date: e.target.value})} /></div>
              <div><label className="label">End Date *</label><input className="input w-full" type="date" required value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})} /></div>
            </div>
            <div><label className="label">Remarks</label><textarea className="input w-full" rows={2} value={form.remarks} onChange={e => setForm({...form, remarks: e.target.value})} /></div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? 'Saving...' : 'Create'}</button>
            </div>
          </form>
        </Modal>
      )}

      {editPolicy && (
        <Modal title="Edit Insurance Policy" onClose={() => setEditPolicy(null)}>
          <form onSubmit={handleUpdate} className="space-y-3">
            <div><label className="label">Policy Number *</label><input className="input w-full" required value={editPolicy.policy_number ?? ''} onChange={e => setEditPolicy({...editPolicy, policy_number: e.target.value})} /></div>
            <div><label className="label">Insurer Name *</label><input className="input w-full" required value={editPolicy.insurer_name ?? ''} onChange={e => setEditPolicy({...editPolicy, insurer_name: e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Insured Value</label><input className="input w-full" type="number" value={editPolicy.insured_value ?? ''} onChange={e => setEditPolicy({...editPolicy, insured_value: Number(e.target.value)})} /></div>
              <div><label className="label">Premium Amount</label><input className="input w-full" type="number" value={editPolicy.premium_amount ?? ''} onChange={e => setEditPolicy({...editPolicy, premium_amount: Number(e.target.value)})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Start Date *</label><input className="input w-full" type="date" required value={editPolicy.start_date?.slice(0, 10) ?? ''} onChange={e => setEditPolicy({...editPolicy, start_date: e.target.value})} /></div>
              <div><label className="label">End Date *</label><input className="input w-full" type="date" required value={editPolicy.end_date?.slice(0, 10) ?? ''} onChange={e => setEditPolicy({...editPolicy, end_date: e.target.value})} /></div>
            </div>
            <div><label className="label">Status</label>
              <select className="input w-full" value={editPolicy.status} onChange={e => setEditPolicy({...editPolicy, status: e.target.value})}>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div><label className="label">Remarks</label><textarea className="input w-full" rows={2} value={editPolicy.remarks ?? ''} onChange={e => setEditPolicy({...editPolicy, remarks: e.target.value})} /></div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setEditPolicy(null)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={updateMutation.isPending} className="btn-primary">{updateMutation.isPending ? 'Saving...' : 'Update'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ─── Contracts Tab ──────────────────────────────────────────── */
function ContractsTab() {
  const { t } = useTranslation(['assetManagement', 'common']);
  const queryClient = useQueryClient();
  const [assetId, setAssetId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    asset_stock_id: '', contract_type: 'warranty', contract_number: '', vendor_name: '',
    file_key: '', file_name: '', file_size: '', effective_from: '', effective_to: '',
  });

  const contractsQuery = useApiQuery<ContractsResponse>(
    queryKeys.assets.list({ type: 'contracts', assetId }),
    assetId ? `/api/inventory/assets/${assetId}/contracts` : '',
    { enabled: !!assetId },
  );

  const items = contractsQuery.data?.data ?? [];
  const loading = contractsQuery.isLoading;

  const invalidateAssets = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.assets.all });

  const createMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    `/api/inventory/assets/${form.asset_stock_id}/contracts`,
    {
      onSuccess: () => {
        toast.success('Contract document recorded');
        setShowForm(false);
        invalidateAssets();
      },
      onError: () => toast.error('Failed to record contract document'),
    },
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.file_key) {
      toast.error('Please select a file to upload');
      return;
    }
    createMutation.mutate({
      ...form,
      file_size: form.file_size ? Number(form.file_size) : undefined,
    });
  };

  const handleFileSelect = async (file: File) => {
    setSelectedFile(file);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post<{ file_key: string; file_name: string; file_size: number }>(
        `/api/inventory/assets/${form.asset_stock_id}/contracts/upload`, fd,
      );
      setForm(prev => ({
        ...prev,
        file_key: res.file_key,
        file_name: res.file_name,
        file_size: String(res.file_size),
      }));
    } catch {
      toast.error('File upload failed');
      setSelectedFile(null);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end">
        <div className="flex-1 min-w-48">
          <label className="label">Asset ID</label>
          <input className="input w-full" type="number" placeholder="Enter asset ID to view documents" value={assetId} onChange={e => setAssetId(e.target.value)} />
        </div>
        <button onClick={() => { setForm({ ...form, asset_stock_id: assetId }); setSelectedFile(null); setShowForm(true); }} className="btn-primary" disabled={!assetId}><Plus className="w-4 h-4" /> Upload Document</button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Type</th><th>Contract #</th><th>Vendor</th><th>File</th><th>Effective From</th><th>Effective To</th></tr></thead>
            <tbody>
              {!assetId ? (
                <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">Enter an asset ID to view contract documents</td></tr>
              ) : loading ? (
                [...Array(3)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              ) : items.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">No contract documents</td></tr>
              ) : items.map(c => (
                <tr key={c.id}>
                  <td><span className="badge-neutral text-xs">{c.contract_type}</span></td>
                  <td className="font-mono text-sm">{c.contract_number ?? '—'}</td>
                  <td className="text-sm">{c.vendor_name ?? '—'}</td>
                  <td className="text-sm">
                    <div className="flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                      <span className="truncate max-w-32">{c.file_name ?? c.file_key}</span>
                    </div>
                  </td>
                  <td className="text-sm">{c.effective_from?.slice(0, 10) ?? '—'}</td>
                  <td className="text-sm">{c.effective_to?.slice(0, 10) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <Modal title="Upload Contract Document" onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="label">Contract Type *</label>
              <select className="input w-full" value={form.contract_type} onChange={e => setForm({...form, contract_type: e.target.value})}>
                <option value="warranty">Warranty</option>
                <option value="lease">Lease</option>
                <option value="service_agreement">Service Agreement</option>
                <option value="purchase">Purchase</option>
                <option value="insurance">Insurance</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Contract Number</label><input className="input w-full" value={form.contract_number} onChange={e => setForm({...form, contract_number: e.target.value})} /></div>
              <div><label className="label">Vendor</label><input className="input w-full" value={form.vendor_name} onChange={e => setForm({...form, vendor_name: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">File *</label>
                {!form.file_key ? (
                  <label className={`input w-full flex items-center justify-center gap-2 cursor-pointer ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
                    <FileText className="w-4 h-4" />
                    <span>{uploading ? 'Uploading...' : 'Choose file'}</span>
                    <input type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} />
                  </label>
                ) : (
                  <div className="input w-full flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate text-sm">{selectedFile?.name ?? form.file_name}</span>
                      {form.file_size && <span className="text-xs text-[var(--color-text-muted)] flex-shrink-0">({(Number(form.file_size) / 1024).toFixed(1)} KB)</span>}
                    </div>
                    <button type="button" onClick={() => setForm({ ...form, file_key: '', file_name: '', file_size: '' })} className="text-red-500 hover:text-red-700 ml-2">×</button>
                  </div>
                )}
              </div>
              <div><label className="label">File Name</label><input className="input w-full" value={form.file_name} onChange={e => setForm({...form, file_name: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Effective From</label><input className="input w-full" type="date" value={form.effective_from} onChange={e => setForm({...form, effective_from: e.target.value})} /></div>
              <div><label className="label">Effective To</label><input className="input w-full" type="date" value={form.effective_to} onChange={e => setForm({...form, effective_to: e.target.value})} /></div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? 'Saving...' : 'Upload'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ─── Reports Tab ─────────────────────────────────────────────── */
function ReportsTab() {
  const { t } = useTranslation(['assetManagement', 'common']);
  const [reportType, setReportType] = useState<'register' | 'maintenance'>('register');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const registerQuery = useApiQuery<AssetsResponse>(
    queryKeys.assets.list({ report: reportType, status: statusFilter, category: categoryFilter }),
    `/api/inventory/assets?status=${statusFilter}&category=${categoryFilter}&limit=100`,
    { enabled: reportType === 'register' },
  );

  const maintenanceQuery = useApiQuery<MaintenanceResponse>(
    queryKeys.assets.maintenance({ report: 'maintenance' }),
    '/api/inventory/assets/maintenance?limit=100',
    { enabled: reportType === 'maintenance' },
  );

  const registerData = registerQuery.data?.data ?? [];
  const maintenanceData = maintenanceQuery.data?.data ?? [];

  const totalValue = registerData.reduce((sum, a) => sum + (a.current_value ?? 0), 0);
  const totalMaintenanceCost = maintenanceData.reduce((sum, m) => sum + (m.cost ?? 0), 0);

  const exportCSV = () => {
    const rows = reportType === 'register'
      ? registerData.map(a => ({
          Asset: a.ItemName, Barcode: a.BarCodeNumber, Category: a.asset_category,
          Manufacturer: a.manufacturer, Department: a.department, Location: a.location,
          Status: a.asset_status, 'Current Value': a.current_value,
        }))
      : maintenanceData.map(m => ({
          Date: m.performed_date, Asset: m.asset_name, Type: m.maintenance_type,
          Description: m.description, 'Performed By': m.performed_by, Cost: m.cost,
          'Next Due': m.next_due_date,
        }));
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => `"${(r as Record<string, unknown>)[h] ?? ''}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `asset-${reportType}-report.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <select className="input w-44" value={reportType} onChange={e => setReportType(e.target.value as 'register' | 'maintenance')}>
          <option value="register">Asset Register</option>
          <option value="maintenance">Maintenance Schedule</option>
        </select>
        {reportType === 'register' && (
          <>
            <select className="input w-36" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="under_repair">Under Repair</option>
              <option value="disposed">Disposed</option>
              <option value="in_storage">In Storage</option>
            </select>
            <select className="input w-40" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
              <option value="">All Categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </>
        )}
        <button onClick={exportCSV} className="btn-secondary"><Download className="w-4 h-4" /> Export CSV</button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {reportType === 'register' ? (
          <>
            <div className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)] uppercase">Total Assets</p><p className="text-xl font-bold mt-1">{registerData.length}</p></div>
            <div className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)] uppercase">Total Value</p><p className="text-xl font-bold mt-1">৳{totalValue.toLocaleString()}</p></div>
            <div className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)] uppercase">Active</p><p className="text-xl font-bold mt-1 text-green-600">{registerData.filter(a => a.asset_status === 'active').length}</p></div>
            <div className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)] uppercase">Disposed</p><p className="text-xl font-bold mt-1 text-gray-500">{registerData.filter(a => a.asset_status === 'disposed').length}</p></div>
          </>
        ) : (
          <>
            <div className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)] uppercase">Total Records</p><p className="text-xl font-bold mt-1">{maintenanceData.length}</p></div>
            <div className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)] uppercase">Total Cost</p><p className="text-xl font-bold mt-1">৳{totalMaintenanceCost.toLocaleString()}</p></div>
            <div className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)] uppercase">AMC Covered</p><p className="text-xl font-bold mt-1 text-green-600">{maintenanceData.filter(m => m.covered_by_amc).length}</p></div>
            <div className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)] uppercase">Upcoming</p><p className="text-xl font-bold mt-1 text-amber-600">{maintenanceData.filter(m => m.next_due_date && new Date(m.next_due_date) > new Date()).length}</p></div>
          </>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          {reportType === 'register' ? (
            <table className="table-base">
              <thead><tr><th>Asset</th><th>Barcode</th><th>Category</th><th>Department</th><th>Status</th><th>Value</th></tr></thead>
              <tbody>
                {registerData.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">No data</td></tr>
                ) : registerData.map(a => (
                  <tr key={a.FixedAssetStockId}>
                    <td className="font-medium">{a.ItemName ?? `Asset #${a.FixedAssetStockId}`}</td>
                    <td className="font-mono text-xs">{a.BarCodeNumber ?? '—'}</td>
                    <td><span className="badge-neutral text-xs">{a.asset_category ?? '—'}</span></td>
                    <td className="text-sm">{a.department ?? '—'}</td>
                    <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[a.asset_status ?? 'active'] ?? 'badge-neutral'}`}>{(a.asset_status ?? 'active').replace('_', ' ')}</span></td>
                    <td className="font-data text-sm">{a.current_value != null ? `৳${a.current_value.toLocaleString()}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="table-base">
              <thead><tr><th>Date</th><th>Asset</th><th>Type</th><th>Description</th><th>Cost</th><th>Next Due</th></tr></thead>
              <tbody>
                {maintenanceData.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">No data</td></tr>
                ) : maintenanceData.map(m => (
                  <tr key={m.id}>
                    <td className="text-sm">{m.performed_date?.slice(0, 10)}</td>
                    <td className="font-medium">{m.asset_name ?? `#${m.id}`}</td>
                    <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${MAINT_BADGE[m.maintenance_type] ?? 'badge-neutral'}`}>{m.maintenance_type}</span></td>
                    <td className="text-sm max-w-48 truncate">{m.description}</td>
                    <td className="font-data text-sm">{m.cost ? `৳${m.cost.toLocaleString()}` : '—'}</td>
                    <td className="text-sm text-[var(--color-text-muted)]">{m.next_due_date?.slice(0, 10) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Tab Map ─────────────────────────────────────────────── */
const TAB_MAP: Record<Tab, { label: string; icon: typeof Package; component: React.ComponentType }> = {
  assets: { label: 'Assets', icon: Package, component: AssetsTab },
  amc: { label: 'AMC Contracts', icon: Shield, component: AMCTab },
  maintenance: { label: 'Maintenance', icon: Settings, component: MaintenanceTab },
  allocations: { label: 'Allocations', icon: MapPin, component: AllocationsTab },
  insurance: { label: 'Insurance', icon: Shield, component: InsuranceTab },
  contracts: { label: 'Contracts', icon: FileText, component: ContractsTab },
  reports: { label: 'Reports', icon: Calendar, component: ReportsTab },
};

/* ─── Main Page ───────────────────────────────────────────── */
function getAssetManagementQueryState(): { tab: Tab; focusLogId?: number } {
  if (typeof window === 'undefined') return { tab: 'assets' };
  const params = new URLSearchParams(window.location.search);
  const requestedTab = params.get('tab');
  const tab = requestedTab && TABS.includes(requestedTab as Tab) ? requestedTab as Tab : 'assets';
  const logParam = Number(params.get('log'));
  return { tab, focusLogId: Number.isFinite(logParam) && logParam > 0 ? logParam : undefined };
}

export default function AssetManagement({ role }: { role?: string }) {
  const { t } = useTranslation(['assetManagement', 'common']);
  const initialQueryState = getAssetManagementQueryState();
  const [tab, setTab] = useState<Tab>(initialQueryState.tab);
  const [focusLogId, setFocusLogId] = useState<number | undefined>(initialQueryState.focusLogId);
  const TabContent = TAB_MAP[tab].component as React.ComponentType<{ focusLogId?: number }>;

  useEffect(() => {
    const handlePopState = () => {
      const state = getAssetManagementQueryState();
      setTab(state.tab);
      setFocusLogId(state.focusLogId);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleTabChange = (nextTab: Tab) => {
    setTab(nextTab);
    if (nextTab !== 'maintenance') setFocusLogId(undefined);
    const params = new URLSearchParams(window.location.search);
    params.set('tab', nextTab);
    if (nextTab !== 'maintenance') params.delete('log');
    const nextUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', nextUrl);
  };

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
              <p className="section-subtitle">Equipment tracking, AMC contracts, insurance, maintenance & reports</p>
            </div>
          </div>
        </div>

        <div className="card p-1.5 flex gap-1 flex-wrap">
          {TABS.map(t => {
            const info = TAB_MAP[t];
            const Icon = info.icon;
            return (
              <button key={t} onClick={() => handleTabChange(t)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === t ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'
                }`}>
                <Icon className="w-4 h-4" />{info.label}
              </button>
            );
          })}
        </div>

        <TabContent focusLogId={tab === 'maintenance' ? focusLogId : undefined} />
      </div>
    </DashboardLayout>
  );
}
