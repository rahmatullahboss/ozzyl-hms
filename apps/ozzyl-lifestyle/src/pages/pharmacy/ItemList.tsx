import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Pencil, ToggleLeft, ToggleRight, X } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import DrugSearchInput from '../../components/DrugSearchInput';
import { useTranslation } from 'react-i18next';

interface Category { id: number; name: string; }
interface Generic { id: number; name: string; }
interface UOM { id: number; name: string; }
interface PackingType { id: number; name: string; }

interface Item {
  id: number;
  name: string;
  item_code?: string;
  generic_name?: string;
  category_name?: string;
  uom_name?: string;
  packing_name?: string;
  generic_id?: number;
  category_id?: number;
  uom_id?: number;
  packing_type_id?: number;
  reorder_level?: number;
  min_stock_qty?: number;
  is_narcotic?: number;
  is_vat_applicable?: number;
  stock_qty?: number;
  is_active: number;
}

const EMPTY_FORM = {
  name: '', itemCode: '', genericId: '', categoryId: '',
  uomId: '', packingTypeId: '', reorderLevel: '10',
  minStockQty: '0', isNarcotic: false, isVatApplicable: false,
};

export default function ItemList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  // Dropdowns for references
  const [categories, setCategories] = useState<Category[]>([]);
  const [generics, setGenerics] = useState<Generic[]>([]);
  const [uoms, setUOMs] = useState<UOM[]>([]);
  const [packingTypes, setPackingTypes] = useState<PackingType[]>([]);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/pharmacy/items', {
        params: { search: search || undefined },
        headers: { Authorization: `Bearer ${token}` },
      });
      setItems(data.items ?? []);
    } catch { setItems([]); } finally { setLoading(false); }
  }, [search]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // Fetch dropdown data for form
  const fetchDropdowns = useCallback(async () => {
    const token = localStorage.getItem('hms_token');
    const headers = { Authorization: `Bearer ${token}` };
    const [catRes, genRes, uomRes, ptRes] = await Promise.allSettled([
      axios.get('/api/pharmacy/categories', { headers }),
      axios.get('/api/pharmacy/generics', { headers }),
      axios.get('/api/pharmacy/uom', { headers }),
      axios.get('/api/pharmacy/packing-types', { headers }),
    ]);
    if (catRes.status === 'fulfilled') setCategories(catRes.value.data.categories ?? []);
    if (genRes.status === 'fulfilled') setGenerics(genRes.value.data.generics ?? []);
    if (uomRes.status === 'fulfilled') setUOMs(uomRes.value.data.uoms ?? []);
    if (ptRes.status === 'fulfilled') setPackingTypes(ptRes.value.data.packingTypes ?? []);
  }, []);

  const handleToggle = async (item: Item) => {
    try {
      const token = localStorage.getItem('hms_token');
      const action = item.is_active ? 'deactivate' : 'activate';
      await axios.put(`/api/pharmacy/items/${item.id}/${action}`, {}, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(t('item.statusUpdated', { defaultValue: `Item ${action}d` }));
      fetchItems();
    } catch { toast.error(t('failedStatus', { defaultValue: 'Failed to update item status' })); }
  };

  const openAdd = () => {
    setEditing(null); setForm({ ...EMPTY_FORM }); fetchDropdowns(); setShowModal(true);
  };
  const openEdit = (item: Item) => {
    setEditing(item);
    setForm({
      name: item.name,
      itemCode: item.item_code ?? '',
      genericId: item.generic_id ? String(item.generic_id) : '',
      categoryId: item.category_id ? String(item.category_id) : '',
      uomId: item.uom_id ? String(item.uom_id) : '',
      packingTypeId: item.packing_type_id ? String(item.packing_type_id) : '',
      reorderLevel: String(item.reorder_level ?? 10),
      minStockQty: String(item.min_stock_qty ?? 0),
      isNarcotic: !!item.is_narcotic,
      isVatApplicable: !!item.is_vat_applicable,
    });
    fetchDropdowns();
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    // F8: Send correct field names matching createPharmacyItemSchema
    const payload = {
      name: form.name,
      itemCode: form.itemCode || undefined,
      genericId: form.genericId ? parseInt(form.genericId) : undefined,
      categoryId: form.categoryId ? parseInt(form.categoryId) : undefined,
      uomId: form.uomId ? parseInt(form.uomId) : undefined,
      packingTypeId: form.packingTypeId ? parseInt(form.packingTypeId) : undefined,
      reorderLevel: parseInt(form.reorderLevel) || 0,
      minStockQty: parseInt(form.minStockQty) || 0,
      isNarcotic: form.isNarcotic,
      isVatApplicable: form.isVatApplicable,
    };
    try {
      const token = localStorage.getItem('hms_token');
      if (editing) {
        await axios.put(`/api/pharmacy/items/${editing.id}`, payload, { headers: { Authorization: `Bearer ${token}` } });
        toast.success(t('itemUpdated', { defaultValue: 'Item updated' }));
      } else {
        await axios.post('/api/pharmacy/items', payload, { headers: { Authorization: `Bearer ${token}` } });
        toast.success(t('itemCreated', { defaultValue: 'Item created' }));
      }
      setShowModal(false); fetchItems();
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : t('item.failedSave', { defaultValue: 'Failed to save item' });
      toast.error(msg || t('item.failed', { defaultValue: 'Failed' }));
    } finally { setSaving(false); }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div><h1 className="page-title">{t('items', { defaultValue: 'Pharmacy Items' })}</h1><p className="section-subtitle mt-1">{t('itemsSubtitle', { defaultValue: 'Manage medicines and consumables' })}</p></div>
          <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" /> {t('addItem', { defaultValue: 'Add Item' })}</button>
        </div>

        <div className="card p-4">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input type="text" placeholder={t('searchItems', { defaultValue: 'Search items…' })} value={search} onChange={e => setSearch(e.target.value)} className="input pl-9" />
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr>
                <th>#</th><th>{t('name', { defaultValue: 'Name' })}</th><th>{t('generic', { defaultValue: 'Generic' })}</th>
                <th>{t('category', { defaultValue: 'Category' })}</th><th>{t('code', { defaultValue: 'Code' })}</th>
                <th>{t('uom', { defaultValue: 'UOM' })}</th><th>{t('reOrderLevel', { defaultValue: 'ROL' })}</th>
                <th className="text-right">{t('stock', { defaultValue: 'Stock' })}</th>
                <th>{t('status', { ns: 'common', defaultValue: 'Status' })}</th><th>{t('actions', { ns: 'common', defaultValue: 'Actions' })}</th>
              </tr></thead>
              <tbody>
                {loading ? ([...Array(6)].map((_, i) => <tr key={i}>{[...Array(10)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>))
                : items.length === 0 ? (<tr><td colSpan={10} className="py-16 text-center text-[var(--color-text-muted)]">{t('noItems', { defaultValue: 'No items found' })}</td></tr>)
                : items.map((item, idx) => (
                  <tr key={item.id}>
                    <td className="text-[var(--color-text-muted)] text-sm">{idx + 1}</td>
                    <td className="font-medium">{item.name}</td>
                    <td className="text-[var(--color-text-secondary)]">{item.generic_name || '—'}</td>
                    <td className="text-[var(--color-text-secondary)]">{item.category_name || '—'}</td>
                    <td className="font-mono text-xs">{item.item_code || '—'}</td>
                    <td className="text-[var(--color-text-secondary)]">{item.uom_name || '—'}</td>
                    <td className="font-data text-right">{item.reorder_level ?? 0}</td>
                    <td className="font-data text-right">{item.stock_qty ?? 0}</td>
                    <td><span className={`badge ${item.is_active ? 'badge-success' : 'badge-secondary'}`}>{item.is_active ? t('active', { ns: 'common', defaultValue: 'Active' }) : t('inactive', { ns: 'common', defaultValue: 'Inactive' })}</span></td>
                    <td>
                      <div className="flex gap-1.5">
                        <button onClick={() => openEdit(item)} className="btn-ghost p-1.5" title="Edit"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => handleToggle(item)} className="btn-ghost p-1.5" title={item.is_active ? 'Deactivate' : 'Activate'}>{item.is_active ? <ToggleRight className="w-4 h-4 text-emerald-600" /> : <ToggleLeft className="w-4 h-4 text-[var(--color-text-muted)]" />}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{editing ? t('editItem', { defaultValue: 'Edit Item' }) : t('addItem', { defaultValue: 'Add Item' })}</h3>
                <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                {!editing && (
                  <div className="bg-[var(--color-bg-soft)] rounded-xl p-3 border border-dashed border-[var(--color-border)]">
                    <label className="label text-xs mb-1.5">🔍 {t('searchMasterDB', { defaultValue: 'Search BD Master Drug Database (17,500+ medicines)' })}</label>
                    <DrugSearchInput onSelect={(drug) => {
                      const name = `${drug.brand_name}${drug.strength ? ' ' + drug.strength : ''}${drug.form ? ' (' + drug.form + ')' : ''}`;
                      setForm(prev => ({ ...prev, name }));
                      toast.success(t('pharmacy.drugSelected', { name: drug.brand_name }));
                    }} />
                  </div>
                )}
                <div><label className="label">{t('name', { defaultValue: 'Item Name' })} *</label><input className="input" required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder={t('item.namePlaceholder', { defaultValue: 'e.g. Paracetamol 500mg' })} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="label">{t('code', { defaultValue: 'Item Code' })}</label><input className="input" value={form.itemCode} onChange={e => setForm({...form, itemCode: e.target.value})} /></div>
                  <div><label className="label">{t('generic', { defaultValue: 'Generic' })}</label>
                    <select className="input" value={form.genericId} onChange={e => setForm({...form, genericId: e.target.value})}>
                      <option value="">{t('none', { defaultValue: '— None —' })}</option>
                      {generics.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="label">{t('category', { defaultValue: 'Category' })}</label>
                    <select className="input" value={form.categoryId} onChange={e => setForm({...form, categoryId: e.target.value})}>
                      <option value="">{t('none', { defaultValue: '— None —' })}</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div><label className="label">{t('uom', { defaultValue: 'UOM' })}</label>
                    <select className="input" value={form.uomId} onChange={e => setForm({...form, uomId: e.target.value})}>
                      <option value="">{t('none', { defaultValue: '— None —' })}</option>
                      {uoms.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div><label className="label">{t('packingType', { defaultValue: 'Packing' })}</label>
                    <select className="input" value={form.packingTypeId} onChange={e => setForm({...form, packingTypeId: e.target.value})}>
                      <option value="">{t('none', { defaultValue: '— None —' })}</option>
                      {packingTypes.map(pt => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
                    </select>
                  </div>
                  <div><label className="label">{t('reOrderLevel', { defaultValue: 'Re-order Level' })}</label><input className="input" type="number" min="0" value={form.reorderLevel} onChange={e => setForm({...form, reorderLevel: e.target.value})} /></div>
                  <div><label className="label">{t('minStockQty', { defaultValue: 'Min Stock' })}</label><input className="input" type="number" min="0" value={form.minStockQty} onChange={e => setForm({...form, minStockQty: e.target.value})} /></div>
                </div>
                <div className="flex gap-6">
                  <label className="flex items-center gap-2"><input type="checkbox" className="rounded" checked={form.isNarcotic} onChange={e => setForm({...form, isNarcotic: e.target.checked})} /><span className="text-sm">{t('narcotic', { defaultValue: 'Narcotic Item' })}</span></label>
                  <label className="flex items-center gap-2"><input type="checkbox" className="rounded" checked={form.isVatApplicable} onChange={e => setForm({...form, isVatApplicable: e.target.checked})} /><span className="text-sm">{t('vatApplicable', { defaultValue: 'VAT Applicable' })}</span></label>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">{t('cancel', { ns: 'common', defaultValue: 'Cancel' })}</button>
                  <button type="submit" disabled={saving} className="btn-primary">{saving ? '…' : editing ? t('save', { ns: 'common', defaultValue: 'Save' }) : t('addItem', { defaultValue: 'Add Item' })}</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
