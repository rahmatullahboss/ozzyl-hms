import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { ArrowRightLeft, Check, PackageCheck, Plus, Send, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

interface Store { StoreId: number; StoreName: string; }
interface StockRow { StockId: number; ItemId: number; ItemName: string; StoreId: number; StoreName?: string; BatchNo?: string; AvailableQuantity: number; }
interface TransferRow { ItemId: number; StockId: number; Quantity: number; BatchNo: string; Remarks: string; }
interface Transfer { TransferId: number; TransferNo: string; FromStoreName?: string; ToStoreName?: string; Status: string; TransferDate?: string; }

export default function InventoryTransferPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['tenantPharmacy']);
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ FromStoreId: '', ToStoreId: '', Remarks: '' });
  const [rows, setRows] = useState<TransferRow[]>([{ ItemId: 0, StockId: 0, Quantity: 1, BatchNo: '', Remarks: '' }]);

  const { data: storesData } = useApiQuery<{ data: Store[] }>(queryKeys.inventory.stores(), '/api/inventory/stores?page=1&limit=100');
  const { data: stockData } = useApiQuery<{ data: StockRow[] }>(['inventory', 'transfer-stock', form.FromStoreId], `/api/inventory/stock/overview?limit=300${form.FromStoreId ? `&StoreId=${form.FromStoreId}` : ''}`);
  const { data: transfersData } = useApiQuery<{ data: Transfer[] }>(['inventory', 'transfers'], '/api/inventory/transfers?page=1&limit=20');
  const stores = storesData?.data ?? [];
  const stocks = stockData?.data ?? [];
  const transfers = transfersData?.data ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory', 'transfers'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.inventory.stock() });
  };
  const createTransfer = useApiMutation<any, any>('post', '/api/inventory/transfers', { onSuccess: () => { toast.success(t('inventory.transfer.success.created')); invalidate(); }, onError: err => toast.error(err.message) });
  const sendTransfer = useApiMutation<any, { id: number }>('post', vars => `/api/inventory/transfers/${vars.id}/send`, { onSuccess: () => { toast.success(t('inventory.transfer.success.sent')); invalidate(); }, onError: err => toast.error(err.message) });
  const receiveTransfer = useApiMutation<any, { id: number }>('post', vars => `/api/inventory/transfers/${vars.id}/receive`, { onSuccess: () => { toast.success(t('inventory.transfer.success.received')); invalidate(); }, onError: err => toast.error(err.message) });

  const selectStock = (idx: number, stockId: number) => {
    const stock = stocks.find(row => row.StockId === stockId);
    setRows(prev => prev.map((row, i) => i === idx ? {
      ...row,
      StockId: stockId,
      ItemId: Number(stock?.ItemId || 0),
      BatchNo: stock?.BatchNo || '',
    } : row));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.FromStoreId || !form.ToStoreId || form.FromStoreId === form.ToStoreId || rows.some(row => !row.StockId || !row.ItemId || row.Quantity <= 0)) {
      toast.error(t('inventory.transfer.errors.selectStoresAndRows'));
      return;
    }
    createTransfer.mutate({
      FromStoreId: Number(form.FromStoreId),
      ToStoreId: Number(form.ToStoreId),
      Remarks: form.Remarks || undefined,
      Items: rows.map(row => ({ ItemId: row.ItemId, StockId: row.StockId, BatchNo: row.BatchNo || undefined, Quantity: row.Quantity, Remarks: row.Remarks || undefined })),
    });
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title"><ArrowRightLeft className="w-6 h-6 inline mr-2" />{t('inventory.transfer.title')}</h1>
            <p className="section-subtitle">{t('inventory.transfer.subtitle')}</p>
          </div>
          <Link to={`${base}/inventory/stock`} className="btn-secondary text-sm">{t('inventory.transfer.stockOverview')}</Link>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <div className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className="label">{t('inventory.transfer.fromStore')}</label><select className="input" required value={form.FromStoreId} onChange={e => setForm({ ...form, FromStoreId: e.target.value })}><option value="">{t('inventory.transfer.selectStore')}</option>{stores.map(store => <option key={store.StoreId} value={store.StoreId}>{store.StoreName}</option>)}</select></div>
            <div><label className="label">{t('inventory.transfer.toStore')}</label><select className="input" required value={form.ToStoreId} onChange={e => setForm({ ...form, ToStoreId: e.target.value })}><option value="">{t('inventory.transfer.selectStore')}</option>{stores.map(store => <option key={store.StoreId} value={store.StoreId}>{store.StoreName}</option>)}</select></div>
            <div><label className="label">{t('inventory.transfer.remarks')}</label><input className="input" value={form.Remarks} onChange={e => setForm({ ...form, Remarks: e.target.value })} /></div>
          </div>

          <div className="card overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex justify-between items-center"><h3 className="font-semibold">{t('inventory.transfer.items.heading')}</h3><button type="button" className="btn-secondary text-sm" onClick={() => setRows(prev => [...prev, { ItemId: 0, StockId: 0, Quantity: 1, BatchNo: '', Remarks: '' }])}><Plus className="w-4 h-4" /> {t('inventory.transfer.items.add')}</button></div>
            <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>{t('inventory.transfer.items.stock')}</th><th>{t('inventory.transfer.items.batch')}</th><th>{t('inventory.transfer.items.available')}</th><th>{t('inventory.transfer.items.qty')}</th><th>{t('inventory.transfer.items.remarks')}</th><th></th></tr></thead><tbody>{rows.map((row, idx) => {
              const stock = stocks.find(s => s.StockId === row.StockId);
              return (
                <tr key={idx}>
                  <td><select className="input min-w-64" value={row.StockId} onChange={e => selectStock(idx, Number(e.target.value))}><option value="">{t('inventory.transfer.selectStock')}</option>{stocks.map(s => <option key={s.StockId} value={s.StockId}>{s.ItemName} · {s.BatchNo || t('inventory.transfer.items.batch')} · {s.AvailableQuantity}</option>)}</select></td>
                  <td>{row.BatchNo || '—'}</td>
                  <td className="font-data">{stock?.AvailableQuantity ?? '—'}</td>
                  <td><input className="input w-20" type="number" min="1" max={stock?.AvailableQuantity || undefined} value={row.Quantity} onChange={e => setRows(prev => prev.map((r, i) => i === idx ? { ...r, Quantity: Number(e.target.value) || 1 } : r))} /></td>
                  <td><input className="input w-44" value={row.Remarks} onChange={e => setRows(prev => prev.map((r, i) => i === idx ? { ...r, Remarks: e.target.value } : r))} /></td>
                  <td>{rows.length > 1 && <button type="button" className="btn-ghost p-1 text-red-500" onClick={() => setRows(prev => prev.filter((_, i) => i !== idx))}><Trash2 className="w-4 h-4" /></button>}</td>
                </tr>
              );
            })}</tbody></table></div>
          </div>

          <div className="flex justify-end"><button className="btn-primary" disabled={createTransfer.isPending}><PackageCheck className="w-4 h-4" /> {createTransfer.isPending ? t('inventory.transfer.saving') : t('inventory.transfer.create')}</button></div>
        </form>

        <div className="card overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border)]"><h3 className="font-semibold">{t('inventory.transfer.recent.heading')}</h3></div>
          <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>{t('inventory.transfer.recent.no')}</th><th>{t('inventory.transfer.recent.date')}</th><th>{t('inventory.transfer.recent.from')}</th><th>{t('inventory.transfer.recent.to')}</th><th>{t('inventory.transfer.recent.status')}</th><th>{t('inventory.transfer.recent.actions')}</th></tr></thead><tbody>{transfers.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">{t('inventory.transfer.recent.empty')}</td></tr> : transfers.map(transfer => (
            <tr key={transfer.TransferId}>
              <td className="font-medium">{transfer.TransferNo}</td><td>{transfer.TransferDate || '—'}</td><td>{transfer.FromStoreName || '—'}</td><td>{transfer.ToStoreName || '—'}</td><td><span className="badge badge-secondary">{transfer.Status}</span></td>
              <td className="flex gap-2">{transfer.Status === 'draft' && <button className="btn-secondary text-xs" onClick={() => sendTransfer.mutate({ id: transfer.TransferId })}><Send className="w-3 h-3" /> {t('inventory.transfer.recent.send')}</button>}{['in_transit', 'partially_received'].includes(transfer.Status) && <button className="btn-secondary text-xs" onClick={() => receiveTransfer.mutate({ id: transfer.TransferId })}><Check className="w-3 h-3" /> {t('inventory.transfer.recent.receive')}</button>}</td>
            </tr>
          ))}</tbody></table></div>
        </div>
      </div>
    </DashboardLayout>
  );
}
