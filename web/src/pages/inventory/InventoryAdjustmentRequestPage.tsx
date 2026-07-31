import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { ClipboardCheck, ClipboardX, Plus, Send, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { useAuth } from '../../hooks/useAuth';

interface Store { StoreId: number; StoreName: string; }
interface StockRow { StockId: number; ItemId: number; ItemName: string; StoreId: number; BatchNo?: string; AvailableQuantity: number; }
interface AdjustmentItem { ItemId: number; StockId: number; BatchNo: string; CurrentQuantity: number; NewQuantity: number; Remarks: string; }
interface AdjustmentRequest { AdjustmentRequestId: number; AdjustmentNo: string; StoreName?: string; Status: string; Reason: string; CreatedOn?: string; }

export default function InventoryAdjustmentRequestPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['tenantPharmacy']);
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const canApproveInventory = user?.role === 'hospital_admin' || permissions.includes('*') || permissions.includes('inventory:approve');
  const [form, setForm] = useState({ StoreId: '', Reason: '', Remarks: '' });
  const [items, setItems] = useState<AdjustmentItem[]>([{ ItemId: 0, StockId: 0, BatchNo: '', CurrentQuantity: 0, NewQuantity: 0, Remarks: '' }]);

  const { data: storesData } = useApiQuery<{ data: Store[] }>(queryKeys.inventory.stores(), '/api/inventory/stores?page=1&limit=100');
  const { data: stockData } = useApiQuery<{ data: StockRow[] }>(['inventory', 'adj-stock', form.StoreId], `/api/inventory/stock/overview?limit=300${form.StoreId ? `&StoreId=${form.StoreId}` : ''}`);
  const { data: requestsData } = useApiQuery<{ data: AdjustmentRequest[] }>(['inventory', 'adjustment-requests'], '/api/inventory/adjustment-requests?page=1&limit=20');
  const stores = storesData?.data ?? [];
  const stocks = stockData?.data ?? [];
  const requests = requestsData?.data ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory', 'adjustment-requests'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.inventory.stock() });
  };

  const createRequest = useApiMutation<any, any>('post', '/api/inventory/adjustment-requests', {
    onSuccess: () => { toast.success(t('inventory.adjustmentRequest.success.submitted')); setItems([{ ItemId: 0, StockId: 0, BatchNo: '', CurrentQuantity: 0, NewQuantity: 0, Remarks: '' }]); setForm({ StoreId: form.StoreId, Reason: '', Remarks: '' }); invalidate(); },
    onError: err => toast.error(err.message),
  });
  const approveRequest = useApiMutation<any, { id: number }>('post', vars => `/api/inventory/adjustment-requests/${vars.id}/approve`, {
    onSuccess: () => { toast.success(t('inventory.adjustmentRequest.success.approved')); invalidate(); },
    onError: err => toast.error(err.message),
  });
  const rejectRequest = useApiMutation<any, { id: number }>('post', vars => `/api/inventory/adjustment-requests/${vars.id}/reject`, {
    onSuccess: () => { toast.success(t('inventory.adjustmentRequest.success.rejected')); invalidate(); },
    onError: err => toast.error(err.message),
  });

  const selectStock = (idx: number, stockId: number) => {
    const stock = stocks.find(s => s.StockId === stockId);
    setItems(prev => prev.map((item, i) => i === idx ? {
      ...item,
      StockId: stockId,
      ItemId: Number(stock?.ItemId || 0),
      BatchNo: stock?.BatchNo || '',
      CurrentQuantity: stock?.AvailableQuantity || 0,
    } : item));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.StoreId || !form.Reason) { toast.error(t('inventory.adjustmentRequest.errors.storeAndReasonRequired')); return; }
    const validItems = items.filter(i => i.ItemId && i.StockId);
    if (validItems.length === 0) { toast.error(t('inventory.adjustmentRequest.errors.addAtLeastOneItem')); return; }
    createRequest.mutate({
      StoreId: Number(form.StoreId),
      Reason: form.Reason,
      Remarks: form.Remarks || undefined,
      Items: validItems.map(i => ({
        ItemId: i.ItemId,
        StockId: i.StockId,
        BatchNo: i.BatchNo || undefined,
        NewQuantity: i.NewQuantity,
        Remarks: i.Remarks || undefined,
      })),
    });
  };

  const difference = (item: AdjustmentItem) => item.NewQuantity - item.CurrentQuantity;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title"><ClipboardCheck className="w-6 h-6 inline mr-2" />{t('inventory.adjustmentRequest.title')}</h1>
            <p className="section-subtitle">{t('inventory.adjustmentRequest.subtitle')}</p>
          </div>
          <Link to={`${base}/inventory/stock`} className="btn-secondary text-sm">{t('inventory.adjustmentRequest.stockOverview')}</Link>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <div className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">{t('inventory.adjustmentRequest.store')}</label>
              <select className="input" required value={form.StoreId} onChange={e => setForm({ ...form, StoreId: e.target.value })}>
                <option value="">{t('inventory.adjustmentRequest.selectStore')}</option>
                {stores.map(s => <option key={s.StoreId} value={s.StoreId}>{s.StoreName}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{t('inventory.adjustmentRequest.reason')}</label>
              <input className="input" required value={form.Reason} onChange={e => setForm({ ...form, Reason: e.target.value })} placeholder={t('inventory.adjustmentRequest.reasonPlaceholder')} />
            </div>
            <div>
              <label className="label">{t('inventory.adjustmentRequest.remarks')}</label>
              <input className="input" value={form.Remarks} onChange={e => setForm({ ...form, Remarks: e.target.value })} />
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex justify-between items-center">
              <h3 className="font-semibold">{t('inventory.adjustmentRequest.items.heading')}</h3>
              <button type="button" className="btn-secondary text-sm" onClick={() => setItems(prev => [...prev, { ItemId: 0, StockId: 0, BatchNo: '', CurrentQuantity: 0, NewQuantity: 0, Remarks: '' }])}>
                <Plus className="w-4 h-4" /> {t('inventory.adjustmentRequest.items.addRow')}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr><th>{t('inventory.adjustmentRequest.items.stock')}</th><th>{t('inventory.adjustmentRequest.items.batch')}</th><th>{t('inventory.adjustmentRequest.items.currentQty')}</th><th>{t('inventory.adjustmentRequest.items.newQty')}</th><th>{t('inventory.adjustmentRequest.items.difference')}</th><th>{t('inventory.adjustmentRequest.items.remarks')}</th><th></th></tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const diff = difference(item);
                    return (
                      <tr key={idx}>
                        <td>
                          <select className="input min-w-64" value={item.StockId} onChange={e => selectStock(idx, Number(e.target.value))}>
                            <option value="">{t('inventory.adjustmentRequest.selectStock')}</option>
                            {stocks.map(s => <option key={s.StockId} value={s.StockId}>{s.ItemName} · {s.BatchNo || t('inventory.adjustmentRequest.items.batch')} · {t('inventory.adjustmentRequest.items.currentQty')}: {s.AvailableQuantity}</option>)}
                          </select>
                        </td>
                        <td>{item.BatchNo || '—'}</td>
                        <td className="font-data">{item.CurrentQuantity || '—'}</td>
                        <td><input className="input w-24" type="number" min="0" value={item.NewQuantity} onChange={e => setItems(prev => prev.map((r, i) => i === idx ? { ...r, NewQuantity: Number(e.target.value) || 0 } : r))} /></td>
                        <td className={`font-data ${diff === 0 ? '' : diff > 0 ? 'text-green-600' : 'text-red-600'}`}>{diff > 0 ? `+${diff}` : diff}</td>
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
            <button className="btn-primary" disabled={createRequest.isPending}>
              <Send className="w-4 h-4" /> {createRequest.isPending ? t('inventory.adjustmentRequest.submitting') : t('inventory.adjustmentRequest.submit')}
            </button>
          </div>
        </form>

        <div className="card overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border)]">
            <h3 className="font-semibold">{t('inventory.adjustmentRequest.records.heading')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>{t('inventory.adjustmentRequest.records.no')}</th><th>{t('inventory.adjustmentRequest.records.date')}</th><th>{t('inventory.adjustmentRequest.records.store')}</th><th>{t('inventory.adjustmentRequest.records.reason')}</th><th>{t('inventory.adjustmentRequest.records.status')}</th><th>{t('inventory.adjustmentRequest.records.actions')}</th></tr>
              </thead>
              <tbody>
                {requests.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">{t('inventory.adjustmentRequest.records.empty')}</td></tr>
                ) : requests.map(req => (
                  <tr key={req.AdjustmentRequestId}>
                    <td className="font-medium">{req.AdjustmentNo}</td>
                    <td>{req.CreatedOn?.slice(0, 10) || '—'}</td>
                    <td>{req.StoreName || '—'}</td>
                    <td className="max-w-48 truncate">{req.Reason}</td>
                    <td>
                      <span className={`badge ${req.Status === 'posted' ? 'badge-success' : req.Status === 'rejected' ? 'badge-destructive' : 'badge-secondary'}`}>
                        {req.Status}
                      </span>
                    </td>
                    <td className="flex gap-2">
                      {req.Status === 'submitted' && canApproveInventory && (
                        <>
                          <button className="btn-secondary text-xs" onClick={() => approveRequest.mutate({ id: req.AdjustmentRequestId })} disabled={approveRequest.isPending}>
                            <ClipboardCheck className="w-3 h-3" /> {t('inventory.adjustmentRequest.records.approve')}
                          </button>
                          <button className="btn-secondary text-xs text-red-500" onClick={() => rejectRequest.mutate({ id: req.AdjustmentRequestId })} disabled={rejectRequest.isPending}>
                            <ClipboardX className="w-3 h-3" /> {t('inventory.adjustmentRequest.records.reject')}
                          </button>
                        </>
                      )}
                    </td>
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
