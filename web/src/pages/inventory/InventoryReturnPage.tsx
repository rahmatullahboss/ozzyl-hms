import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { RotateCcw, Plus, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

interface Store { StoreId: number; StoreName: string; }
interface Item { ItemId: number; ItemName: string; }
interface ReturnRow { ItemId: number; StockId: string; BatchNo: string; Quantity: number; ConsumptionItemId: string; Remarks: string; }

export const REASONS = ['unused', 'wrong_item', 'damaged', 'expired', 'over_issued', 'patient_refused', 'other'];

export default function InventoryReturnPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['tenantPharmacy']);
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const queryClient = useQueryClient();
  const [returnType, setReturnType] = useState<'department_return' | 'patient_return'>('department_return');
  const [form, setForm] = useState({ FromDepartment: 'Ward', PatientId: '', ToStoreId: '', Reason: 'unused', AdjustPatientBill: false, Remarks: '' });
  const [rows, setRows] = useState<ReturnRow[]>([{ ItemId: 0, StockId: '', BatchNo: '', Quantity: 1, ConsumptionItemId: '', Remarks: '' }]);

  const { data: storesData } = useApiQuery<{ data: Store[] }>(queryKeys.inventory.stores(), '/api/inventory/stores?page=1&limit=100');
  const { data: itemsData } = useApiQuery<{ data: Item[] }>(queryKeys.inventory.items(), '/api/inventory/items?page=1&limit=300');
  const stores = storesData?.data ?? [];
  const items = itemsData?.data ?? [];

  const createReturn = useApiMutation<any, any>('post', () => `/api/inventory/returns/${returnType === 'patient_return' ? 'patient' : 'department'}`, {
    onSuccess: (data) => {
      toast.success(data?.BillingAdjustmentStatus === 'requires_billing_review' ? t('inventory.return.success.billingReview') : t('inventory.return.success.recorded'));
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.stock() });
      setRows([{ ItemId: 0, StockId: '', BatchNo: '', Quantity: 1, ConsumptionItemId: '', Remarks: '' }]);
    },
    onError: err => toast.error(err.message),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.ToStoreId || rows.some(row => !row.ItemId || row.Quantity <= 0)) {
      toast.error(t('inventory.return.errors.selectStoreAndItems'));
      return;
    }
    createReturn.mutate({
      ReturnType: returnType,
      FromDepartment: form.FromDepartment || undefined,
      PatientId: returnType === 'patient_return' && form.PatientId ? Number(form.PatientId) : undefined,
      ToStoreId: Number(form.ToStoreId),
      Reason: form.Reason,
      AdjustPatientBill: returnType === 'patient_return' && form.AdjustPatientBill,
      Remarks: form.Remarks || undefined,
      Items: rows.map(row => ({
        ItemId: row.ItemId,
        StockId: row.StockId ? Number(row.StockId) : undefined,
        BatchNo: row.BatchNo || undefined,
        Quantity: row.Quantity,
        ConsumptionItemId: row.ConsumptionItemId ? Number(row.ConsumptionItemId) : undefined,
        Remarks: row.Remarks || undefined,
      })),
    });
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title"><RotateCcw className="w-6 h-6 inline mr-2" />{t('inventory.return.title')}</h1>
            <p className="section-subtitle">{t('inventory.return.subtitle')}</p>
          </div>
          <Link to={`${base}/inventory/stock`} className="btn-secondary text-sm">{t('inventory.return.stockOverview')}</Link>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <div className="card p-5 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div><label className="label">{t('inventory.return.returnType')}</label><select className="input" value={returnType} onChange={e => setReturnType(e.target.value as 'department_return' | 'patient_return')}><option value="department_return">{t('inventory.return.returnTypes.department')}</option><option value="patient_return">{t('inventory.return.returnTypes.patient')}</option></select></div>
            <div><label className="label">{t('inventory.return.toStore')}</label><select className="input" required value={form.ToStoreId} onChange={e => setForm({ ...form, ToStoreId: e.target.value })}><option value="">{t('inventory.return.selectStore')}</option>{stores.map(store => <option key={store.StoreId} value={store.StoreId}>{store.StoreName}</option>)}</select></div>
            <div><label className="label">{t('inventory.return.reason')}</label><select className="input" value={form.Reason} onChange={e => setForm({ ...form, Reason: e.target.value })}>{REASONS.map(reason => <option key={reason} value={reason}>{t(`inventory.return.reasons.${reason}`)}</option>)}</select></div>
            {returnType === 'patient_return' ? <div><label className="label">{t('inventory.return.patientId')}</label><input className="input" required value={form.PatientId} onChange={e => setForm({ ...form, PatientId: e.target.value })} /></div> : <div><label className="label">{t('inventory.return.fromDepartment')}</label><input className="input" value={form.FromDepartment} onChange={e => setForm({ ...form, FromDepartment: e.target.value })} /></div>}
            <div><label className="label">{t('inventory.return.remarks')}</label><input className="input" value={form.Remarks} onChange={e => setForm({ ...form, Remarks: e.target.value })} /></div>
            {returnType === 'patient_return' && <label className="flex items-center gap-2 text-sm mt-7"><input type="checkbox" checked={form.AdjustPatientBill} onChange={e => setForm({ ...form, AdjustPatientBill: e.target.checked })} /> {t('inventory.return.adjustBill')}</label>}
          </div>

          <div className="card overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex justify-between items-center"><h3 className="font-semibold">{t('inventory.return.items.heading')}</h3><button type="button" className="btn-secondary text-sm" onClick={() => setRows(prev => [...prev, { ItemId: 0, StockId: '', BatchNo: '', Quantity: 1, ConsumptionItemId: '', Remarks: '' }])}><Plus className="w-4 h-4" /> {t('inventory.return.items.add')}</button></div>
            <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>{t('inventory.return.items.item')}</th><th>{t('inventory.return.items.stockId')}</th><th>{t('inventory.return.items.batch')}</th><th>{t('inventory.return.items.qty')}</th><th>{t('inventory.return.items.consumption')}</th><th>{t('inventory.return.items.remarks')}</th><th></th></tr></thead><tbody>{rows.map((row, idx) => (
              <tr key={idx}>
                <td><select className="input min-w-48" value={row.ItemId} onChange={e => setRows(prev => prev.map((r, i) => i === idx ? { ...r, ItemId: Number(e.target.value) } : r))}><option value="">{t('inventory.return.selectItem')}</option>{items.map(item => <option key={item.ItemId} value={item.ItemId}>{item.ItemName}</option>)}</select></td>
                <td><input className="input w-24" value={row.StockId} onChange={e => setRows(prev => prev.map((r, i) => i === idx ? { ...r, StockId: e.target.value } : r))} /></td>
                <td><input className="input w-28" value={row.BatchNo} onChange={e => setRows(prev => prev.map((r, i) => i === idx ? { ...r, BatchNo: e.target.value } : r))} /></td>
                <td><input className="input w-20" type="number" min="1" value={row.Quantity} onChange={e => setRows(prev => prev.map((r, i) => i === idx ? { ...r, Quantity: Number(e.target.value) || 1 } : r))} /></td>
                <td><input className="input w-28" value={row.ConsumptionItemId} onChange={e => setRows(prev => prev.map((r, i) => i === idx ? { ...r, ConsumptionItemId: e.target.value } : r))} /></td>
                <td><input className="input w-40" value={row.Remarks} onChange={e => setRows(prev => prev.map((r, i) => i === idx ? { ...r, Remarks: e.target.value } : r))} /></td>
                <td>{rows.length > 1 && <button type="button" className="btn-ghost p-1 text-red-500" onClick={() => setRows(prev => prev.filter((_, i) => i !== idx))}><Trash2 className="w-4 h-4" /></button>}</td>
              </tr>
            ))}</tbody></table></div>
          </div>

          <div className="flex justify-end"><button className="btn-primary" disabled={createReturn.isPending}><Save className="w-4 h-4" /> {createReturn.isPending ? t('inventory.return.saving') : t('inventory.return.record')}</button></div>
        </form>
      </div>
    </DashboardLayout>
  );
}
