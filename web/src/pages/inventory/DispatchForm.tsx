import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Truck, Plus, Trash2, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

interface Store { StoreId: number; StoreName: string; }
interface Item { ItemId: number; ItemName: string; }
interface DispItem { ItemId: number; DispatchedQuantity: number; BatchNo: string; }

export default function DispatchForm({ role = 'hospital_admin' }: { role?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const [form, setForm] = useState({ SourceStoreId: '', DestinationStoreId: '', Remarks: '' });
  const [dispItems, setDispItems] = useState<DispItem[]>([{ ItemId: 0, DispatchedQuantity: 1, BatchNo: '' }]);
  const { t } = useTranslation(['inventory', 'common']);

  const { data: storesData } = useApiQuery<{ data: Store[] }>(
    queryKeys.inventory.stores(),
    '/api/inventory/stores?page=1&limit=50',
  );
  const { data: itemsData } = useApiQuery<{ data: Item[] }>(
    queryKeys.inventory.items(),
    '/api/inventory/items?page=1&limit=200',
  );

  const stores = storesData?.data ?? [];
  const items = itemsData?.data ?? [];

  const addRow = () => setDispItems(prev => [...prev, { ItemId: 0, DispatchedQuantity: 1, BatchNo: '' }]);
  const removeRow = (idx: number) => setDispItems(prev => prev.filter((_, i) => i !== idx));

  const createDispatch = useApiMutation<unknown, unknown>(
    'post',
    '/api/inventory/dispatches',
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.inventory.dispatches() });
        queryClient.invalidateQueries({ queryKey: queryKeys.inventory.stock() });
        toast.success(t('inventory.dispatch_created'));
        navigate(`${base}/inventory/dispatches`);
      },
      onError: (err) => {
        toast.error(err.message || t('inventory.createDispatchFailed'));
      },
    },
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    createDispatch.mutate({
      ...form,
      SourceStoreId: Number(form.SourceStoreId),
      DestinationStoreId: Number(form.DestinationStoreId),
      Items: dispItems,
    });
  };

  const saving = createDispatch.isPending;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        <div className="page-header"><h1 className="page-title"><Truck className="w-6 h-6 inline mr-2" />{t('newDispatch', { ns: 'inventory' })}</h1></div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className="label">{t('sourceStore', { ns: 'inventory' })} *</label><select className="input" required value={form.SourceStoreId} onChange={e => setForm({...form, SourceStoreId: e.target.value})}><option value="">{t('selectStore', { ns: 'inventory' })}</option>{stores.map(s => <option key={s.StoreId} value={s.StoreId}>{s.StoreName}</option>)}</select></div>
            <div><label className="label">{t('destinationStore', { ns: 'inventory' })} *</label><select className="input" required value={form.DestinationStoreId} onChange={e => setForm({...form, DestinationStoreId: e.target.value})}><option value="">{t('selectStore', { ns: 'inventory' })}</option>{stores.map(s => <option key={s.StoreId} value={s.StoreId}>{s.StoreName}</option>)}</select></div>
            <div><label className="label">{t('remarks', { ns: 'inventory' })}</label><input className="input" value={form.Remarks} onChange={e => setForm({...form, Remarks: e.target.value})} /></div>
          </div>
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex justify-between"><h3 className="font-semibold">{t('items', { ns: 'inventory' })}</h3><button type="button" onClick={addRow} className="btn-secondary text-sm"><Plus className="w-4 h-4 mr-1 inline" /> {t('add', { ns: 'common' })}</button></div>
            <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>{t('item', { ns: 'inventory' })} *</th><th>{t('quantity', { ns: 'inventory' })} *</th><th>{t('batchNo', { ns: 'inventory' })}</th><th></th></tr></thead><tbody>{dispItems.map((item, idx) => (
              <tr key={idx}><td><select className="input" value={item.ItemId} onChange={e => setDispItems(prev => prev.map((d,i) => i===idx ? {...d, ItemId: Number(e.target.value)} : d))} required><option value="">{t('selectItem', { ns: 'inventory' })}</option>{items.map(it => <option key={it.ItemId} value={it.ItemId}>{it.ItemName}</option>)}</select></td>
              <td><input className="input w-24" type="number" min="1" value={item.DispatchedQuantity} onChange={e => setDispItems(prev => prev.map((d,i) => i===idx ? {...d, DispatchedQuantity: parseInt(e.target.value)||0} : d))} /></td>
              <td><input className="input w-28" value={item.BatchNo} onChange={e => setDispItems(prev => prev.map((d,i) => i===idx ? {...d, BatchNo: e.target.value} : d))} /></td>
              <td>{dispItems.length > 1 && <button type="button" onClick={() => removeRow(idx)} className="btn-ghost p-1 text-red-500"><Trash2 className="w-4 h-4" /></button>}</td></tr>))}</tbody></table></div>
          </div>
          <div className="flex justify-end gap-3"><button type="button" onClick={() => navigate(`${base}/inventory/dispatches`)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button><button type="submit" disabled={saving} className="btn-primary"><Save className="w-4 h-4 mr-1 inline" /> {saving ? t('loading', { ns: 'common' }) : t('dispatches', { ns: 'inventory' })}</button></div>
        </form>
      </div>
    </DashboardLayout>
  );
}
