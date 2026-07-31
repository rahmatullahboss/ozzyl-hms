import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { FileText, Plus, Trash2, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

interface Item { ItemId: number; ItemName: string; }
interface Store { StoreId: number; StoreName: string; }
interface ReqItem { ItemId: number; RequestedQuantity: number; Remarks: string; }

export default function RequisitionForm({ role = 'hospital_admin' }: { role?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const [form, setForm] = useState({ RequestingStoreId: '', SourceStoreId: '', Priority: 'normal', RequiredDate: '', Remarks: '' });
  const [reqItems, setReqItems] = useState<ReqItem[]>([{ ItemId: 0, RequestedQuantity: 1, Remarks: '' }]);
  const { t } = useTranslation(['inventory', 'common']);

  const { data: itemsData } = useApiQuery<{ data: Item[] }>(
    queryKeys.inventory.items(),
    '/api/inventory/items?page=1&limit=200',
  );
  const { data: storesData } = useApiQuery<{ data: Store[] }>(
    queryKeys.inventory.stores(),
    '/api/inventory/stores?page=1&limit=50',
  );

  const items = itemsData?.data ?? [];
  const stores = storesData?.data ?? [];

  const addRow = () => setReqItems(prev => [...prev, { ItemId: 0, RequestedQuantity: 1, Remarks: '' }]);
  const removeRow = (idx: number) => setReqItems(prev => prev.filter((_, i) => i !== idx));

  const createRequisition = useApiMutation<unknown, unknown>(
    'post',
    '/api/inventory/requisitions',
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.inventory.requisitions() });
        toast.success(t('inventory.requisition_created'));
        navigate(`${base}/inventory/requisitions`);
      },
      onError: (err) => {
        toast.error(err.message || t('inventory.createRequisitionFailed'));
      },
    },
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    createRequisition.mutate({
      ...form,
      RequestingStoreId: Number(form.RequestingStoreId),
      SourceStoreId: Number(form.SourceStoreId),
      Items: reqItems,
    });
  };

  const saving = createRequisition.isPending;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        <div className="page-header"><h1 className="page-title"><FileText className="w-6 h-6 inline mr-2" />{t('newRequisition', { ns: 'inventory' })}</h1></div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="card p-5 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div><label className="label">{t('requestingStore', { ns: 'inventory' })} *</label><select className="input" required value={form.RequestingStoreId} onChange={e => setForm({...form, RequestingStoreId: e.target.value})}><option value="">{t('selectStore', { ns: 'inventory' })}</option>{stores.map(s => <option key={s.StoreId} value={s.StoreId}>{s.StoreName}</option>)}</select></div>
            <div><label className="label">{t('sourceStore', { ns: 'inventory' })} *</label><select className="input" required value={form.SourceStoreId} onChange={e => setForm({...form, SourceStoreId: e.target.value})}><option value="">{t('selectStore', { ns: 'inventory' })}</option>{stores.map(s => <option key={s.StoreId} value={s.StoreId}>{s.StoreName}</option>)}</select></div>
            <div><label className="label">{t('priority', { ns: 'inventory' })}</label><select className="input" value={form.Priority} onChange={e => setForm({...form, Priority: e.target.value})}><option value="low">{t('low', { ns: 'inventory' })}</option><option value="normal">{t('normal', { ns: 'inventory' })}</option><option value="high">{t('high', { ns: 'inventory' })}</option><option value="urgent">{t('urgent', { ns: 'inventory' })}</option></select></div>
            <div><label className="label">{t('requiredDate', { ns: 'inventory' })}</label><input className="input" type="date" value={form.RequiredDate} onChange={e => setForm({...form, RequiredDate: e.target.value})} /></div>
          </div>
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex justify-between"><h3 className="font-semibold">{t('items', { ns: 'inventory' })}</h3><button type="button" onClick={addRow} className="btn-secondary text-sm"><Plus className="w-4 h-4 mr-1 inline" /> {t('add', { ns: 'common' })}</button></div>
            <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>{t('item', { ns: 'inventory' })} *</th><th>{t('quantity', { ns: 'inventory' })} *</th><th>{t('remarks', { ns: 'inventory' })}</th><th></th></tr></thead><tbody>{reqItems.map((item, idx) => (
              <tr key={idx}><td><select className="input" value={item.ItemId} onChange={e => setReqItems(prev => prev.map((r,i) => i===idx ? {...r, ItemId: Number(e.target.value)} : r))} required><option value="">{t('selectItem', { ns: 'inventory' })}</option>{items.map(it => <option key={it.ItemId} value={it.ItemId}>{it.ItemName}</option>)}</select></td>
              <td><input className="input w-24" type="number" min="1" value={item.RequestedQuantity} onChange={e => setReqItems(prev => prev.map((r,i) => i===idx ? {...r, RequestedQuantity: parseInt(e.target.value)||0} : r))} /></td>
              <td><input className="input" value={item.Remarks} onChange={e => setReqItems(prev => prev.map((r,i) => i===idx ? {...r, Remarks: e.target.value} : r))} /></td>
              <td>{reqItems.length > 1 && <button type="button" onClick={() => removeRow(idx)} className="btn-ghost p-1 text-red-500"><Trash2 className="w-4 h-4" /></button>}</td></tr>))}</tbody></table></div>
          </div>
          <div className="flex justify-end gap-3"><button type="button" onClick={() => navigate(`${base}/inventory/requisitions`)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button><button type="submit" disabled={saving} className="btn-primary"><Save className="w-4 h-4 mr-1 inline" /> {saving ? t('loading', { ns: 'common' }) : t('submit', { ns: 'common' })}</button></div>
        </form>
      </div>
    </DashboardLayout>
  );
}
