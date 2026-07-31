import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { Building2, Factory, Package, Plus, Search, Store } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

type Tab = 'vendors' | 'stores' | 'items';

export const INVENTORY_ITEM_TYPE_OPTIONS = [
  { value: 'medicine', label: 'Medicine' },
  { value: 'consumable', label: 'Consumable' },
  { value: 'lab_reagent', label: 'Laboratory Reagent' },
  { value: 'radiology_consumable', label: 'Radiology / X-ray Consumable' },
  { value: 'ot_item', label: 'OT Item' },
  { value: 'ward_item', label: 'Ward Item' },
  { value: 'general', label: 'General' },
  { value: 'asset', label: 'Asset' },
  { value: 'equipment', label: 'Equipment' },
] as const;

interface Vendor { VendorId: number; VendorName: string; VendorCode?: string; ContactPerson?: string; ContactPhone?: string; ContactEmail?: string; City?: string; IsActive: number; }
interface StoreRow { StoreId: number; StoreName: string; StoreCode?: string; StoreType: string; Address?: string; ContactPerson?: string; IsActive: number; }
interface ItemRow { ItemId: number; ItemName: string; ItemCode?: string; ItemType: string; CategoryName?: string; UOMName?: string; StandardRate: number; IsActive: number; ReOrderLevel: number; }

export default function InventoryMasterDataPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['tenantPharmacy']);
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('vendors');
  const [search, setSearch] = useState('');

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title"><Factory className="w-6 h-6 inline mr-2" />{t('inventory.masterData.title')}</h1>
            <p className="section-subtitle">{t('inventory.masterData.subtitle')}</p>
          </div>
        </div>

        <div className="flex gap-2 border-b border-[var(--color-border)]">
          {([['vendors', Building2, t('inventory.masterData.tab.vendors')], ['stores', Store, t('inventory.masterData.tab.stores')], ['items', Package, t('inventory.masterData.tab.items')]] as const).map(([key, Icon, label]) => (
            <button key={key} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === key ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`} onClick={() => { setTab(key); setSearch(''); }}>
              <Icon className="w-4 h-4 inline mr-1" />{label}
            </button>
          ))}
        </div>

        <div className="flex gap-3 items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input className="input pl-9" placeholder={t('inventory.masterData.searchPlaceholder', { tab })} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {tab === 'vendors' && <VendorTab search={search} />}
        {tab === 'stores' && <StoreTab search={search} />}
        {tab === 'items' && <ItemTab search={search} />}
      </div>
    </DashboardLayout>
  );
}

function VendorTab({ search }: { search: string }) {
  const { t } = useTranslation(['tenantPharmacy']);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ VendorName: '', VendorCode: '', ContactPerson: '', ContactPhone: '', ContactEmail: '', City: '', CreditPeriod: 30 });

  const { data, isLoading } = useApiQuery<{ data: Vendor[] }>(
    ['inventory', 'vendors', search],
    `/api/inventory/vendors?page=1&limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}`,
  );
  const vendors = data?.data ?? [];

  const createVendor = useApiMutation<any, any>('post', '/api/inventory/vendors', {
    onSuccess: () => { toast.success(t('inventory.masterData.vendor.created')); setShowForm(false); setForm({ VendorName: '', VendorCode: '', ContactPerson: '', ContactPhone: '', ContactEmail: '', City: '', CreditPeriod: 30 }); queryClient.invalidateQueries({ queryKey: ['inventory', 'vendors'] }); },
    onError: err => toast.error(err.message),
  });

  const seedDefaultVendors = useApiMutation<{ summary?: { created?: number; skipped?: number; total?: number } }, void>('post', '/api/inventory/vendors/defaults/seed', {
    onSuccess: (data) => { toast.success(t('inventory.masterData.vendor.defaultsLoaded', { count: data?.summary?.created ?? 0 })); queryClient.invalidateQueries({ queryKey: ['inventory', 'vendors'] }); },
    onError: err => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-secondary text-sm" disabled={seedDefaultVendors.isPending} onClick={() => seedDefaultVendors.mutate()}>{t('inventory.masterData.vendor.loadDefaults')}</button>
        <button className="btn-primary text-sm" onClick={() => setShowForm(!showForm)}><Plus className="w-4 h-4" /> {t('inventory.masterData.vendor.add')}</button>
      </div>

      {showForm && (
        <div className="card p-5 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div><label className="label">{t('inventory.masterData.fields.name')}</label><input className="input" required value={form.VendorName} onChange={e => setForm({ ...form, VendorName: e.target.value })} /></div>
          <div><label className="label">{t('inventory.masterData.fields.code')}</label><input className="input" value={form.VendorCode} onChange={e => setForm({ ...form, VendorCode: e.target.value })} /></div>
          <div><label className="label">{t('inventory.masterData.fields.contactPerson')}</label><input className="input" value={form.ContactPerson} onChange={e => setForm({ ...form, ContactPerson: e.target.value })} /></div>
          <div><label className="label">{t('inventory.masterData.fields.phone')}</label><input className="input" value={form.ContactPhone} onChange={e => setForm({ ...form, ContactPhone: e.target.value })} /></div>
          <div><label className="label">{t('inventory.masterData.fields.email')}</label><input className="input" type="email" value={form.ContactEmail} onChange={e => setForm({ ...form, ContactEmail: e.target.value })} /></div>
          <div><label className="label">{t('inventory.masterData.fields.city')}</label><input className="input" value={form.City} onChange={e => setForm({ ...form, City: e.target.value })} /></div>
          <div><label className="label">{t('inventory.masterData.fields.creditPeriod')}</label><input className="input" type="number" value={form.CreditPeriod} onChange={e => setForm({ ...form, CreditPeriod: Number(e.target.value) })} /></div>
          <div className="flex items-end"><button className="btn-primary w-full" onClick={() => { if (!form.VendorName) { toast.error(t('inventory.masterData.errors.nameRequired')); return; } createVendor.mutate(form); }}>{t('inventory.masterData.save')}</button></div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>{t('inventory.masterData.fields.name')}</th><th>{t('inventory.masterData.fields.code')}</th><th>{t('inventory.masterData.fields.contact')}</th><th>{t('inventory.masterData.fields.phone')}</th><th>{t('inventory.masterData.fields.city')}</th><th>{t('inventory.masterData.fields.creditDays')}</th><th>{t('inventory.masterData.fields.status')}</th></tr></thead>
            <tbody>
              {vendors.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-[var(--color-text-muted)]">{isLoading ? t('inventory.masterData.loading') : t('inventory.masterData.vendor.empty')}</td></tr> : vendors.map(v => (
                <tr key={v.VendorId}>
                  <td className="font-medium">{v.VendorName}</td>
                  <td>{v.VendorCode || '—'}</td>
                  <td>{v.ContactPerson || '—'}</td>
                  <td>{v.ContactPhone || '—'}</td>
                  <td>{v.City || '—'}</td>
                  <td className="font-data">—</td>
                  <td><span className={`badge ${v.IsActive ? 'badge-success' : 'badge-destructive'}`}>{v.IsActive ? t('inventory.masterData.status.active') : t('inventory.masterData.status.inactive')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StoreTab({ search }: { search: string }) {
  const { t } = useTranslation(['tenantPharmacy']);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ StoreName: '', StoreCode: '', StoreType: 'main', Address: '', ContactPerson: '' });

  const { data, isLoading } = useApiQuery<{ data: StoreRow[] }>(
    ['inventory', 'stores', search],
    `/api/inventory/stores?page=1&limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}`,
  );
  const stores = data?.data ?? [];

  const createStore = useApiMutation<any, any>('post', '/api/inventory/stores', {
    onSuccess: () => { toast.success(t('inventory.masterData.store.created')); setShowForm(false); setForm({ StoreName: '', StoreCode: '', StoreType: 'main', Address: '', ContactPerson: '' }); queryClient.invalidateQueries({ queryKey: ['inventory', 'stores'] }); },
    onError: err => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary text-sm" onClick={() => setShowForm(!showForm)}><Plus className="w-4 h-4" /> {t('inventory.masterData.store.add')}</button>
      </div>

      {showForm && (
        <div className="card p-5 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div><label className="label">{t('inventory.masterData.fields.name')}</label><input className="input" required value={form.StoreName} onChange={e => setForm({ ...form, StoreName: e.target.value })} /></div>
          <div><label className="label">{t('inventory.masterData.fields.code')}</label><input className="input" value={form.StoreCode} onChange={e => setForm({ ...form, StoreCode: e.target.value })} /></div>
          <div><label className="label">{t('inventory.masterData.fields.type')}</label><select className="input" value={form.StoreType} onChange={e => setForm({ ...form, StoreType: e.target.value })}><option value="main">{t('inventory.masterData.storeType.main')}</option><option value="substore">{t('inventory.masterData.storeType.substore')}</option><option value="pharmacy">{t('inventory.masterData.storeType.pharmacy')}</option><option value="lab">{t('inventory.masterData.storeType.lab')}</option><option value="ot">{t('inventory.masterData.storeType.ot')}</option><option value="emergency">{t('inventory.masterData.storeType.emergency')}</option><option value="ward">{t('inventory.masterData.storeType.ward')}</option></select></div>
          <div><label className="label">{t('inventory.masterData.fields.address')}</label><input className="input" value={form.Address} onChange={e => setForm({ ...form, Address: e.target.value })} /></div>
          <div><label className="label">{t('inventory.masterData.fields.contactPerson')}</label><input className="input" value={form.ContactPerson} onChange={e => setForm({ ...form, ContactPerson: e.target.value })} /></div>
          <div className="flex items-end"><button className="btn-primary w-full" onClick={() => { if (!form.StoreName) { toast.error(t('inventory.masterData.errors.nameRequired')); return; } createStore.mutate(form); }}>{t('inventory.masterData.save')}</button></div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>{t('inventory.masterData.fields.name')}</th><th>{t('inventory.masterData.fields.code')}</th><th>{t('inventory.masterData.fields.type')}</th><th>{t('inventory.masterData.fields.address')}</th><th>{t('inventory.masterData.fields.contact')}</th><th>{t('inventory.masterData.fields.status')}</th></tr></thead>
            <tbody>
              {stores.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">{isLoading ? t('inventory.masterData.loading') : t('inventory.masterData.store.empty')}</td></tr> : stores.map(s => (
                <tr key={s.StoreId}>
                  <td className="font-medium">{s.StoreName}</td>
                  <td>{s.StoreCode || '—'}</td>
                  <td><span className="badge badge-secondary">{s.StoreType}</span></td>
                  <td>{s.Address || '—'}</td>
                  <td>{s.ContactPerson || '—'}</td>
                  <td><span className={`badge ${s.IsActive ? 'badge-success' : 'badge-destructive'}`}>{s.IsActive ? t('inventory.masterData.status.active') : t('inventory.masterData.status.inactive')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ItemTab({ search }: { search: string }) {
  const { t } = useTranslation(['tenantPharmacy']);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ItemName: '', ItemCode: '', ItemType: 'consumable', StandardRate: 0, ReOrderLevel: 10, MinStockQuantity: 5 });

  const { data, isLoading } = useApiQuery<{ data: ItemRow[] }>(
    ['inventory', 'items', search],
    `/api/inventory/items?page=1&limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}`,
  );
  const items = data?.data ?? [];

  const createItem = useApiMutation<any, any>('post', '/api/inventory/items', {
    onSuccess: () => { toast.success(t('inventory.masterData.item.created')); setShowForm(false); setForm({ ItemName: '', ItemCode: '', ItemType: 'consumable', StandardRate: 0, ReOrderLevel: 10, MinStockQuantity: 5 }); queryClient.invalidateQueries({ queryKey: ['inventory', 'items'] }); },
    onError: err => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary text-sm" onClick={() => setShowForm(!showForm)}><Plus className="w-4 h-4" /> {t('inventory.masterData.item.add')}</button>
      </div>

      {showForm && (
        <div className="card p-5 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div><label className="label">{t('inventory.masterData.fields.name')}</label><input className="input" required value={form.ItemName} onChange={e => setForm({ ...form, ItemName: e.target.value })} /></div>
          <div><label className="label">{t('inventory.masterData.fields.code')}</label><input className="input" value={form.ItemCode} onChange={e => setForm({ ...form, ItemCode: e.target.value })} /></div>
          <div><label className="label">{t('inventory.masterData.fields.type')}</label><select className="input" value={form.ItemType} onChange={e => setForm({ ...form, ItemType: e.target.value })}>{INVENTORY_ITEM_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
          <div><label className="label">{t('inventory.masterData.fields.standardRate')}</label><input className="input" type="number" min="0" value={form.StandardRate} onChange={e => setForm({ ...form, StandardRate: Number(e.target.value) })} /></div>
          <div><label className="label">{t('inventory.masterData.fields.reorderLevel')}</label><input className="input" type="number" min="0" value={form.ReOrderLevel} onChange={e => setForm({ ...form, ReOrderLevel: Number(e.target.value) })} /></div>
          <div><label className="label">{t('inventory.masterData.fields.minStockQty')}</label><input className="input" type="number" min="0" value={form.MinStockQuantity} onChange={e => setForm({ ...form, MinStockQuantity: Number(e.target.value) })} /></div>
          <div className="flex items-end"><button className="btn-primary w-full" onClick={() => { if (!form.ItemName) { toast.error(t('inventory.masterData.errors.nameRequired')); return; } createItem.mutate(form); }}>{t('inventory.masterData.save')}</button></div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>{t('inventory.masterData.fields.name')}</th><th>{t('inventory.masterData.fields.code')}</th><th>{t('inventory.masterData.fields.type')}</th><th>{t('inventory.masterData.fields.category')}</th><th>{t('inventory.masterData.fields.uom')}</th><th>{t('inventory.masterData.fields.rate')}</th><th>{t('inventory.masterData.fields.reorder')}</th><th>{t('inventory.masterData.fields.status')}</th></tr></thead>
            <tbody>
              {items.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-[var(--color-text-muted)]">{isLoading ? t('inventory.masterData.loading') : t('inventory.masterData.item.empty')}</td></tr> : items.map(i => (
                <tr key={i.ItemId}>
                  <td className="font-medium">{i.ItemName}</td>
                  <td>{i.ItemCode || '—'}</td>
                  <td><span className="badge badge-secondary">{i.ItemType}</span></td>
                  <td>{i.CategoryName || '—'}</td>
                  <td>{i.UOMName || '—'}</td>
                  <td className="font-data">{i.StandardRate}</td>
                  <td className="font-data">{i.ReOrderLevel}</td>
                  <td><span className={`badge ${i.IsActive ? 'badge-success' : 'badge-destructive'}`}>{i.IsActive ? t('inventory.masterData.status.active') : t('inventory.masterData.status.inactive')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
