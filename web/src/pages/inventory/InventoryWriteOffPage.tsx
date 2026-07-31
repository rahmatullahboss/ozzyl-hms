import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { AlertTriangle, CheckCircle, Plus, Send, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { useAuth } from '../../hooks/useAuth';

interface Store { StoreId: number; StoreName: string; }
interface StockRow { StockId: number; ItemId: number; ItemName: string; StoreId: number; BatchNo?: string; AvailableQuantity: number; ExpiryDate?: string; }
interface WriteOffItemRow { ItemId: number; StockId: number; Quantity: number; Remarks: string; }
interface WriteOff { WriteOffId: number; WriteOffNo: string; StoreName?: string; Reason: string; IsApproved: number; WriteOffDate?: string; Description?: string; }

export const REASON_OPTIONS = [
  { value: 'expired', labelKey: 'inventory.writeOff.reasons.expired' },
  { value: 'damaged', labelKey: 'inventory.writeOff.reasons.damaged' },
  { value: 'theft', labelKey: 'inventory.writeOff.reasons.theft' },
  { value: 'other', labelKey: 'inventory.writeOff.reasons.other' },
] as const;

export default function InventoryWriteOffPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['tenantPharmacy']);
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const canApproveWriteOff = user?.role === 'hospital_admin' || permissions.includes('*') || permissions.includes('inventory:approve');
  const [form, setForm] = useState({ StoreId: '', Reason: 'expired' as string, Description: '', Remarks: '' });
  const [items, setItems] = useState<WriteOffItemRow[]>([{ ItemId: 0, StockId: 0, Quantity: 1, Remarks: '' }]);

  const { data: storesData } = useApiQuery<{ data: Store[] }>(queryKeys.inventory.stores(), '/api/inventory/stores?page=1&limit=100');
  const { data: stockData } = useApiQuery<{ data: StockRow[] }>(['inventory', 'writeoff-stock', form.StoreId], `/api/inventory/stock/overview?limit=300${form.StoreId ? `&StoreId=${form.StoreId}` : ''}`);
  const { data: writeOffsData } = useApiQuery<{ data: WriteOff[] }>(['inventory', 'writeoffs'], '/api/inventory/writeoff?page=1&limit=20');
  const stores = storesData?.data ?? [];
  const stocks = stockData?.data ?? [];
  const writeOffs = writeOffsData?.data ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory', 'writeoffs'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.inventory.stock() });
  };

  const createWriteOff = useApiMutation<any, any>('post', '/api/inventory/writeoff', {
    onSuccess: () => { toast.success(t('inventory.writeOff.success.created')); setItems([{ ItemId: 0, StockId: 0, Quantity: 1, Remarks: '' }]); invalidate(); },
    onError: err => toast.error(err.message),
  });
  const approveWriteOff = useApiMutation<any, { id: number }>('put', vars => `/api/inventory/writeoff/${vars.id}/approve`, {
    onSuccess: () => { toast.success(t('inventory.writeOff.success.approved')); invalidate(); },
    onError: err => toast.error(err.message),
  });

  const selectStock = (idx: number, stockId: number) => {
    const stock = stocks.find(s => s.StockId === stockId);
    setItems(prev => prev.map((item, i) => i === idx ? {
      ...item,
      StockId: stockId,
      ItemId: Number(stock?.ItemId || 0),
    } : item));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.StoreId || !form.Reason) { toast.error(t('inventory.writeOff.errors.storeAndReasonRequired')); return; }
    const validItems = items.filter(i => i.ItemId && i.StockId && i.Quantity > 0);
    if (validItems.length === 0) { toast.error(t('inventory.writeOff.errors.addAtLeastOneItem')); return; }
    createWriteOff.mutate({
      StoreId: Number(form.StoreId),
      Reason: form.Reason,
      Description: form.Description || undefined,
      Remarks: form.Remarks || undefined,
      Items: validItems.map(i => ({ ItemId: i.ItemId, StockId: i.StockId, Quantity: i.Quantity, Remarks: i.Remarks || undefined })),
    });
  };

  const totalItems = items.filter(i => i.StockId && i.Quantity > 0).length;
  const totalQty = items.reduce((sum, i) => sum + (i.StockId ? i.Quantity : 0), 0);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title"><AlertTriangle className="w-6 h-6 inline mr-2" />{t('inventory.writeOff.title')}</h1>
            <p className="section-subtitle">{t('inventory.writeOff.subtitle')}</p>
          </div>
          <Link to={`${base}/inventory/stock`} className="btn-secondary text-sm">{t('inventory.writeOff.stockOverview')}</Link>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <div className="card p-5 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="label">{t('inventory.writeOff.create.store')}</label>
              <select className="input" required value={form.StoreId} onChange={e => setForm({ ...form, StoreId: e.target.value })}>
                <option value="">{t('inventory.writeOff.selectStore')}</option>
                {stores.map(s => <option key={s.StoreId} value={s.StoreId}>{s.StoreName}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{t('inventory.writeOff.create.reason')}</label>
              <select className="input" required value={form.Reason} onChange={e => setForm({ ...form, Reason: e.target.value })}>
                {REASON_OPTIONS.map(r => <option key={r.value} value={r.value}>{t(r.labelKey)}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{t('inventory.writeOff.create.description')}</label>
              <input className="input" value={form.Description} onChange={e => setForm({ ...form, Description: e.target.value })} placeholder={t('inventory.writeOff.create.descriptionPlaceholder')} />
            </div>
            <div>
              <label className="label">{t('inventory.writeOff.create.remarks')}</label>
              <input className="input" value={form.Remarks} onChange={e => setForm({ ...form, Remarks: e.target.value })} />
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex justify-between items-center">
              <h3 className="font-semibold">{t('inventory.writeOff.items.heading', { totalItems, totalQty })}</h3>
              <button type="button" className="btn-secondary text-sm" onClick={() => setItems(prev => [...prev, { ItemId: 0, StockId: 0, Quantity: 1, Remarks: '' }])}>
                <Plus className="w-4 h-4" /> {t('inventory.writeOff.items.addRow')}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr><th>{t('inventory.writeOff.items.stock')}</th><th>{t('inventory.writeOff.items.batch')}</th><th>{t('inventory.writeOff.items.available')}</th><th>{t('inventory.writeOff.items.expiry')}</th><th>{t('inventory.writeOff.items.qty')}</th><th>{t('inventory.writeOff.items.remarks')}</th><th></th></tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const stock = stocks.find(s => s.StockId === item.StockId);
                    return (
                      <tr key={idx}>
                        <td>
                          <select className="input min-w-64" value={item.StockId} onChange={e => selectStock(idx, Number(e.target.value))}>
                            <option value="">{t('inventory.writeOff.selectStock')}</option>
                            {stocks.map(s => <option key={s.StockId} value={s.StockId}>{s.ItemName} · {s.BatchNo || t('inventory.writeOff.items.batch')} · {t('inventory.writeOff.items.qty')}: {s.AvailableQuantity}</option>)}
                          </select>
                        </td>
                        <td>{stock?.BatchNo || '—'}</td>
                        <td className="font-data">{stock?.AvailableQuantity ?? '—'}</td>
                        <td className="text-sm">{stock?.ExpiryDate?.slice(0, 10) || '—'}</td>
                        <td><input className="input w-24" type="number" min="1" max={stock?.AvailableQuantity || undefined} value={item.Quantity} onChange={e => setItems(prev => prev.map((r, i) => i === idx ? { ...r, Quantity: Number(e.target.value) || 1 } : r))} /></td>
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
            <button className="btn-primary" disabled={createWriteOff.isPending}>
              <Send className="w-4 h-4" /> {createWriteOff.isPending ? t('inventory.writeOff.creating') : t('inventory.writeOff.createButton')}
            </button>
          </div>
        </form>

        <div className="card overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border)]">
            <h3 className="font-semibold">{t('inventory.writeOff.records.heading')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>{t('inventory.writeOff.records.no')}</th><th>{t('inventory.writeOff.records.date')}</th><th>{t('inventory.writeOff.records.store')}</th><th>{t('inventory.writeOff.records.reason')}</th><th>{t('inventory.writeOff.records.status')}</th><th>{t('inventory.writeOff.records.actions')}</th></tr>
              </thead>
              <tbody>
                {writeOffs.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">{t('inventory.writeOff.records.empty')}</td></tr>
                ) : writeOffs.map(wo => (
                  <tr key={wo.WriteOffId}>
                    <td className="font-medium">{wo.WriteOffNo}</td>
                    <td>{wo.WriteOffDate?.slice(0, 10) || '—'}</td>
                    <td>{wo.StoreName || '—'}</td>
                    <td><span className="badge badge-secondary">{wo.Reason}</span></td>
                    <td><span className={`badge ${wo.IsApproved ? 'badge-success' : 'badge-warning'}`}>{wo.IsApproved ? t('inventory.writeOff.records.approved') : t('inventory.writeOff.records.pending')}</span></td>
                    <td>
                      {!wo.IsApproved && canApproveWriteOff && (
                        <button className="btn-secondary text-xs" onClick={() => approveWriteOff.mutate({ id: wo.WriteOffId })} disabled={approveWriteOff.isPending}>
                          <CheckCircle className="w-3 h-3" /> {t('inventory.writeOff.records.approve')}
                        </button>
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
