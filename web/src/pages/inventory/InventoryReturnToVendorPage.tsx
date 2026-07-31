import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { CornerDownLeft, Plus, Send, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

interface Vendor { VendorId: number; VendorName: string; }
interface Store { StoreId: number; StoreName: string; }
interface StockRow { StockId: number; ItemId: number; GRItemId?: number; ItemName: string; StoreId: number; BatchNo?: string; AvailableQuantity: number; }
interface ReturnItemRow { ItemId: number; GRItemId: number; ReturnQuantity: number; Remarks: string; }
interface ReturnToVendor { ReturnId: number; ReturnNo: string; VendorName?: string; StoreName?: string; Reason: string; ReturnDate?: string; CreditNoteNo?: string; }

export default function InventoryReturnToVendorPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['tenantPharmacy']);
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ VendorId: '', StoreId: '', GoodsReceiptId: '', Reason: '', CreditNoteNo: '', Remarks: '' });
  const [items, setItems] = useState<ReturnItemRow[]>([{ ItemId: 0, GRItemId: 0, ReturnQuantity: 1, Remarks: '' }]);

  const { data: vendorsData } = useApiQuery<{ data: Vendor[] }>(['inventory', 'vendors'], '/api/inventory/vendors?page=1&limit=100');
  const { data: storesData } = useApiQuery<{ data: Store[] }>(queryKeys.inventory.stores(), '/api/inventory/stores?page=1&limit=100');
  const { data: stockData } = useApiQuery<{ data: StockRow[] }>(['inventory', 'return-stock', form.StoreId], `/api/inventory/stock/overview?limit=300${form.StoreId ? `&StoreId=${form.StoreId}` : ''}`);
  const { data: returnsData } = useApiQuery<{ data: ReturnToVendor[] }>(['inventory', 'returns-vendor'], '/api/inventory/return?page=1&limit=20');
  const vendors = vendorsData?.data ?? [];
  const stores = storesData?.data ?? [];
  const stocks = stockData?.data ?? [];
  const returns = returnsData?.data ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory', 'returns-vendor'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.inventory.stock() });
  };

  const createReturn = useApiMutation<any, any>('post', '/api/inventory/return', {
    onSuccess: () => { toast.success(t('inventory.returnToVendor.created')); setItems([{ ItemId: 0, GRItemId: 0, ReturnQuantity: 1, Remarks: '' }]); invalidate(); },
    onError: err => toast.error(err.message),
  });

  const selectStock = (idx: number, stockId: number) => {
    const stock = stocks.find(s => s.StockId === stockId);
    setItems(prev => prev.map((item, i) => i === idx ? {
      ...item,
      ItemId: Number(stock?.ItemId || 0),
      GRItemId: Number(stock?.GRItemId || 0),
    } : item));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.VendorId || !form.StoreId || !form.GoodsReceiptId || !form.Reason) {
      toast.error(t('inventory.returnToVendor.vendorStoreReasonRequired'));
      return;
    }
    const validItems = items.filter(i => i.ItemId && i.GRItemId && i.ReturnQuantity > 0);
    if (validItems.length === 0) { toast.error(t('inventory.returnToVendor.addAtLeastOneItem')); return; }
    createReturn.mutate({
      VendorId: Number(form.VendorId),
      StoreId: Number(form.StoreId),
      GoodsReceiptId: Number(form.GoodsReceiptId),
      Reason: form.Reason,
      CreditNoteNo: form.CreditNoteNo || undefined,
      Remarks: form.Remarks || undefined,
      Items: validItems.map(i => ({ ItemId: i.ItemId, GRItemId: i.GRItemId, ReturnQuantity: i.ReturnQuantity, Remarks: i.Remarks || undefined })),
    });
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title"><CornerDownLeft className="w-6 h-6 inline mr-2" />{t('inventory.returnToVendor.title')}</h1>
            <p className="section-subtitle">{t('inventory.returnToVendor.subtitle')}</p>
          </div>
          <Link to={`${base}/inventory/stock`} className="btn-secondary text-sm">{t('inventory.returnToVendor.stockOverview')}</Link>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <div className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">{t('inventory.returnToVendor.vendor')}</label>
              <select className="input" required value={form.VendorId} onChange={e => setForm({ ...form, VendorId: e.target.value })}>
                <option value="">{t('inventory.returnToVendor.selectVendor')}</option>
                {vendors.map(v => <option key={v.VendorId} value={v.VendorId}>{v.VendorName}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{t('inventory.returnToVendor.store')}</label>
              <select className="input" required value={form.StoreId} onChange={e => setForm({ ...form, StoreId: e.target.value })}>
                <option value="">{t('inventory.returnToVendor.selectStore')}</option>
                {stores.map(s => <option key={s.StoreId} value={s.StoreId}>{s.StoreName}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{t('inventory.returnToVendor.goodsReceiptId')}</label>
              <input className="input" required type="number" value={form.GoodsReceiptId} onChange={e => setForm({ ...form, GoodsReceiptId: e.target.value })} placeholder={t('inventory.returnToVendor.grIdPlaceholder')} />
            </div>
            <div>
              <label className="label">{t('inventory.returnToVendor.reason')}</label>
              <input className="input" required value={form.Reason} onChange={e => setForm({ ...form, Reason: e.target.value })} placeholder={t('inventory.returnToVendor.reasonPlaceholder')} />
            </div>
            <div>
              <label className="label">{t('inventory.returnToVendor.creditNoteNo')}</label>
              <input className="input" value={form.CreditNoteNo} onChange={e => setForm({ ...form, CreditNoteNo: e.target.value })} />
            </div>
            <div>
              <label className="label">{t('inventory.returnToVendor.remarks')}</label>
              <input className="input" value={form.Remarks} onChange={e => setForm({ ...form, Remarks: e.target.value })} />
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex justify-between items-center">
              <h3 className="font-semibold">{t('inventory.returnToVendor.returnItems')}</h3>
              <button type="button" className="btn-secondary text-sm" onClick={() => setItems(prev => [...prev, { ItemId: 0, GRItemId: 0, ReturnQuantity: 1, Remarks: '' }])}>
                <Plus className="w-4 h-4" /> {t('inventory.returnToVendor.addRow')}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr><th>{t('inventory.returnToVendor.stockCol')}</th><th>{t('inventory.returnToVendor.batchCol')}</th><th>{t('inventory.returnToVendor.availableCol')}</th><th>{t('inventory.returnToVendor.returnQtyCol')}</th><th>{t('inventory.returnToVendor.remarksCol')}</th><th></th></tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const stock = stocks.find(s => s.StockId === item.GRItemId || (s.ItemId === item.ItemId && s.StoreId === Number(form.StoreId)));
                    return (
                      <tr key={idx}>
                        <td>
                          <select className="input min-w-64" value={item.GRItemId || ''} onChange={e => selectStock(idx, Number(e.target.value))}>
                            <option value="">{t('inventory.returnToVendor.selectStock')}</option>
                            {stocks.map(s => <option key={s.StockId} value={s.StockId}>{s.ItemName} · {s.BatchNo || t('inventory.returnToVendor.noBatch')} · {t('inventory.returnToVendor.qtyLabel')}: {s.AvailableQuantity}</option>)}
                          </select>
                        </td>
                        <td>{stock?.BatchNo || '—'}</td>
                        <td className="font-data">{stock?.AvailableQuantity ?? '—'}</td>
                        <td><input className="input w-24" type="number" min="1" max={stock?.AvailableQuantity || undefined} value={item.ReturnQuantity} onChange={e => setItems(prev => prev.map((r, i) => i === idx ? { ...r, ReturnQuantity: Number(e.target.value) || 1 } : r))} /></td>
                        <td><input className="input w-40" value={item.Remarks} onChange={e => setItems(prev => prev.map((r, i) => i === idx ? { ...r, Remarks: e.target.value } : r))} /></td>
                        <td>{items.length > 1 && <button type="button" className="btn-ghost p-1 text-red-500" onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}><Trash2 className="w-4 h-4" /></button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end">
            <button className="btn-primary" disabled={createReturn.isPending}>
              <Send className="w-4 h-4" /> {createReturn.isPending ? t('inventory.returnToVendor.creating') : t('inventory.returnToVendor.createReturn')}
            </button>
          </div>
        </form>

        <div className="card overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border)]">
            <h3 className="font-semibold">{t('inventory.returnToVendor.returnRecords')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>{t('inventory.returnToVendor.no')}</th><th>{t('inventory.returnToVendor.date')}</th><th>{t('inventory.returnToVendor.vendorCol')}</th><th>{t('inventory.returnToVendor.storeCol')}</th><th>{t('inventory.returnToVendor.reasonCol')}</th><th>{t('inventory.returnToVendor.creditNoteCol')}</th></tr>
              </thead>
              <tbody>
                {returns.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">{t('inventory.returnToVendor.noReturns')}</td></tr>
                ) : returns.map(ret => (
                  <tr key={ret.ReturnId}>
                    <td className="font-medium">{ret.ReturnNo}</td>
                    <td>{ret.ReturnDate?.slice(0, 10) || '—'}</td>
                    <td>{ret.VendorName || '—'}</td>
                    <td>{ret.StoreName || '—'}</td>
                    <td className="max-w-40 truncate">{ret.Reason}</td>
                    <td>{ret.CreditNoteNo || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
