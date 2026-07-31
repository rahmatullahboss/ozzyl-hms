import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ClipboardList, Plus, QrCode, Trash2, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

interface Vendor { VendorId: number; VendorName: string; }
interface Store { StoreId: number; StoreName: string; StoreType?: string; }
interface Item {
  ItemId: number;
  ItemName: string;
  ItemCode?: string;
  Barcode?: string;
  StandardRate?: number;
  PurchasePrice?: number;
  SalePrice?: number;
  VATPercentage?: number;
}
export interface GoodsReceiptResponse {
  projectionPending?: boolean;
  warnings?: string[];
}

export interface GRItem {
  ItemId: number;
  BatchNo: string;
  ManufactureDate: string;
  ExpiryDate: string;
  ReceivedQuantity: number;
  RejectedQuantity: number;
  FreeQuantity: number;
  ItemRate: number;
  MRP: number;
  VATPercent: number;
  TotalAmount: number;
  Remarks: string;
}

const emptyRow = (): GRItem => ({
  ItemId: 0,
  BatchNo: '',
  ManufactureDate: '',
  ExpiryDate: '',
  ReceivedQuantity: 1,
  RejectedQuantity: 0,
  FreeQuantity: 0,
  ItemRate: 0,
  MRP: 0,
  VATPercent: 0,
  TotalAmount: 0,
  Remarks: '',
});

export function goodsReceiptRejectedQuantityError(receivedQuantity: number, rejectedQuantity: number): string | null {
  if (!Number.isFinite(rejectedQuantity) || rejectedQuantity < 0) return 'Rejected quantity cannot be negative';
  if (rejectedQuantity > receivedQuantity) return 'Rejected quantity cannot exceed received quantity';
  return null;
}

type GoodsReceiptSubmissionIdentity = { signature: string; key: string };

export function resolveGoodsReceiptSubmissionKey(
  current: GoodsReceiptSubmissionIdentity | null,
  payload: unknown,
  generateKey: () => string = () => crypto.randomUUID(),
): GoodsReceiptSubmissionIdentity {
  const signature = JSON.stringify(payload);
  if (current?.signature === signature) return current;
  return { signature, key: generateKey() };
}

export function toGoodsReceiptItemPayload(item: GRItem) {
  return {
    ItemId: item.ItemId,
    BatchNo: item.BatchNo || undefined,
    ManufactureDate: item.ManufactureDate || undefined,
    ExpiryDate: item.ExpiryDate || undefined,
    ReceivedQuantity: item.ReceivedQuantity,
    RejectedQuantity: item.RejectedQuantity,
    FreeQuantity: item.FreeQuantity,
    ItemRate: item.ItemRate,
    MRP: item.MRP || item.ItemRate,
    VATPercent: item.VATPercent,
    DiscountPercent: 0,
    Remarks: item.Remarks || undefined,
  };
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function GoodsReceiptForm({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['inventory', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const submissionIdentityRef = useRef<GoodsReceiptSubmissionIdentity | null>(null);
  const [form, setForm] = useState({
    VendorId: '',
    StoreId: '',
    GRDate: todayDate(),
    VendorBillNo: '',
    VendorBillDate: '',
    PaymentMode: 'credit',
    CreditPeriod: '30',
    Remarks: '',
  });
  const [grItems, setGRItems] = useState<GRItem[]>([emptyRow()]);

  const { data: vendorsData } = useApiQuery<{ data: Vendor[] }>(
    queryKeys.inventory.vendors(),
    '/api/inventory/vendors?page=1&limit=100',
  );
  const { data: storesData } = useApiQuery<{ data: Store[] }>(
    queryKeys.inventory.stores(),
    '/api/inventory/stores?page=1&limit=100',
  );
  const { data: itemsData } = useApiQuery<{ data: Item[] }>(
    queryKeys.inventory.items(),
    '/api/inventory/items?page=1&limit=200',
  );

  const vendors = vendorsData?.data ?? [];
  const stores = storesData?.data ?? [];
  const items = itemsData?.data ?? [];

  const addRow = () => setGRItems(prev => [...prev, emptyRow()]);
  const removeRow = (idx: number) => setGRItems(prev => prev.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: string, value: any) => {
    setGRItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const u = { ...item, [field]: value };
      if (field === 'ItemId') {
        const found = items.find(it => it.ItemId === Number(value));
        if (found) {
          u.ItemRate = Number(found.PurchasePrice || found.StandardRate || 0);
          u.MRP = Number(found.SalePrice || found.StandardRate || u.ItemRate || 0);
          u.VATPercent = Number(found.VATPercentage || 0);
        }
      }
      u.TotalAmount = Number(u.ReceivedQuantity || 0) * Number(u.ItemRate || 0) * (1 + Number(u.VATPercent || 0) / 100);
      return u;
    }));
  };

  const handleScan = (value: string) => {
    const code = value.trim().toLowerCase();
    if (!code) return;
    const found = items.find(item =>
      item.ItemCode?.toLowerCase() === code ||
      item.Barcode?.toLowerCase() === code ||
      item.ItemName.toLowerCase() === code
    );
    if (!found) {
      toast.error('Scanned item was not found in item master');
      return;
    }
    setGRItems(prev => {
      const existing = prev.findIndex(row => row.ItemId === found.ItemId && !row.BatchNo);
      if (existing >= 0) {
        return prev.map((row, index) => index === existing
          ? { ...row, ReceivedQuantity: row.ReceivedQuantity + 1, TotalAmount: (row.ReceivedQuantity + 1) * row.ItemRate * (1 + row.VATPercent / 100) }
          : row
        );
      }
      const row = emptyRow();
      row.ItemId = found.ItemId;
      row.ItemRate = Number(found.PurchasePrice || found.StandardRate || 0);
      row.MRP = Number(found.SalePrice || found.StandardRate || row.ItemRate || 0);
      row.VATPercent = Number(found.VATPercentage || 0);
      row.TotalAmount = row.ReceivedQuantity * row.ItemRate * (1 + row.VATPercent / 100);
      return prev.length === 1 && prev[0].ItemId === 0 ? [row] : [...prev, row];
    });
    toast.success(`Added ${found.ItemName}`);
  };

  const total = grItems.reduce((s, i) => s + i.TotalAmount, 0);

  const createGRN = useApiMutation<GoodsReceiptResponse, unknown>(
    'post',
    '/api/inventory/goods-receipts',
    {
      onSuccess: (response) => {
        queryClient.invalidateQueries({ queryKey: queryKeys.inventory.goodsReceipts() });
        queryClient.invalidateQueries({ queryKey: queryKeys.inventory.stock() });
        if (response.projectionPending) {
          toast.error(response.warnings?.[0] || 'Goods receipt stock was saved, but post-processing is pending. Submit again to repair.');
          return;
        }
        submissionIdentityRef.current = null;
        toast.success(t('inventory.goods_receipt_created'));
        navigate(`${base}/inventory/gr`);
      },
      onError: (err) => {
        toast.error(err.message || t('inventory.createGrnFailed'));
      },
    },
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.VendorId || !form.StoreId || !form.GRDate) {
      toast.error('Vendor, store, and receive date are required');
      return;
    }
    const invalidItem = grItems.find(item => !item.ItemId || item.ReceivedQuantity <= 0 || item.ItemRate <= 0);
    if (invalidItem) {
      toast.error('Each row needs item, quantity, and purchase rate');
      return;
    }
    const invalidRejectedQuantity = grItems
      .map(item => goodsReceiptRejectedQuantityError(item.ReceivedQuantity, item.RejectedQuantity))
      .find(Boolean);
    if (invalidRejectedQuantity) {
      toast.error(invalidRejectedQuantity);
      return;
    }

    const payload = {
      VendorId: Number(form.VendorId),
      StoreId: Number(form.StoreId),
      GRDate: form.GRDate,
      VendorBillNo: form.VendorBillNo || undefined,
      VendorBillDate: form.VendorBillDate || undefined,
      PaymentMode: form.PaymentMode as 'cash' | 'credit' | 'cheque',
      CreditPeriod: Number(form.CreditPeriod || 30),
      Remarks: form.Remarks || undefined,
      TotalAmount: total,
      Items: grItems.map(toGoodsReceiptItemPayload),
    };
    const identity = resolveGoodsReceiptSubmissionKey(submissionIdentityRef.current, payload);
    submissionIdentityRef.current = identity;
    createGRN.mutate({ ...payload, IdempotencyKey: identity.key });
  };

  const saving = createGRN.isPending;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        <div className="page-header"><h1 className="page-title"><ClipboardList className="w-6 h-6 inline mr-2" />New Goods Receipt</h1></div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="card p-5 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div><label className="label">Supplier *</label><select className="input" required value={form.VendorId} onChange={e => setForm({...form, VendorId: e.target.value})}><option value="">Select supplier…</option>{vendors.map(v => <option key={v.VendorId} value={v.VendorId}>{v.VendorName}</option>)}</select></div>
            <div><label className="label">Store *</label><select className="input" required value={form.StoreId} onChange={e => setForm({...form, StoreId: e.target.value})}><option value="">Select store…</option>{stores.map(s => <option key={s.StoreId} value={s.StoreId}>{s.StoreName}</option>)}</select></div>
            <div><label className="label">Receive date *</label><input className="input" type="date" required value={form.GRDate} onChange={e => setForm({...form, GRDate: e.target.value})} /></div>
            <div><label className="label">Scan item</label><div className="relative"><QrCode className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" /><input className="input pl-9" placeholder="Scan then Enter" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleScan((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; } }} /></div></div>
            <div><label className="label">{t('inventory.vendor_bill_no')}</label><input className="input" value={form.VendorBillNo} onChange={e => setForm({...form, VendorBillNo: e.target.value})} /></div>
            <div><label className="label">{t('inventory.bill_date')}</label><input className="input" type="date" value={form.VendorBillDate} onChange={e => setForm({...form, VendorBillDate: e.target.value})} /></div>
            <div><label className="label">{t('inventory.payment_mode')}</label><select className="input" value={form.PaymentMode} onChange={e => setForm({...form, PaymentMode: e.target.value})}><option value="cash">Cash</option><option value="credit">Credit</option><option value="cheque">Cheque</option></select></div>
            <div><label className="label">Credit days</label><input className="input" type="number" min="0" value={form.CreditPeriod} onChange={e => setForm({...form, CreditPeriod: e.target.value})} /></div>
            <div className="md:col-span-4"><label className="label">{t('inventory.remarks')}</label><input className="input" value={form.Remarks} onChange={e => setForm({...form, Remarks: e.target.value})} /></div>
          </div>
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex justify-between items-center"><h3 className="font-semibold">Receipt Items</h3><button type="button" onClick={addRow} className="btn-secondary text-sm"><Plus className="w-4 h-4 mr-1 inline" /> Add</button></div>
            <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Item *</th><th>Batch</th><th>Mfg</th><th>Expiry</th><th>Received *</th><th>Rejected</th><th>Free</th><th>Rate *</th><th>MRP</th><th>VAT%</th><th>Total</th><th></th></tr></thead><tbody>{grItems.map((item, idx) => (
              <tr key={idx}>
                <td><select className="input min-w-52" value={item.ItemId} onChange={e => updateItem(idx, 'ItemId', Number(e.target.value))} required><option value="">Select…</option>{items.map(it => <option key={it.ItemId} value={it.ItemId}>{it.ItemName}{it.ItemCode ? ` (${it.ItemCode})` : ''}</option>)}</select></td>
                <td><input className="input w-24" value={item.BatchNo} onChange={e => updateItem(idx, 'BatchNo', e.target.value)} /></td>
                <td><input className="input w-32" type="date" value={item.ManufactureDate} onChange={e => updateItem(idx, 'ManufactureDate', e.target.value)} /></td>
                <td><input className="input w-32" type="date" value={item.ExpiryDate} onChange={e => updateItem(idx, 'ExpiryDate', e.target.value)} /></td>
                <td><input aria-label="Received quantity" className="input w-20" type="number" min="1" value={item.ReceivedQuantity} onChange={e => updateItem(idx, 'ReceivedQuantity', parseInt(e.target.value)||0)} /></td>
                <td><input aria-label="Rejected quantity" className="input w-20" type="number" min="0" max={item.ReceivedQuantity} value={item.RejectedQuantity} onChange={e => updateItem(idx, 'RejectedQuantity', parseInt(e.target.value)||0)} /></td>
                <td><input className="input w-20" type="number" min="0" value={item.FreeQuantity} onChange={e => updateItem(idx, 'FreeQuantity', parseInt(e.target.value)||0)} /></td>
                <td><input className="input w-24" type="number" step="0.01" value={item.ItemRate} onChange={e => updateItem(idx, 'ItemRate', parseFloat(e.target.value)||0)} /></td>
                <td><input className="input w-24" type="number" step="0.01" value={item.MRP} onChange={e => updateItem(idx, 'MRP', parseFloat(e.target.value)||0)} /></td>
                <td><input className="input w-20" type="number" step="0.01" value={item.VATPercent} onChange={e => updateItem(idx, 'VATPercent', parseFloat(e.target.value)||0)} /></td>
                <td className="font-data font-semibold">৳{item.TotalAmount.toFixed(2)}</td>
                <td>{grItems.length > 1 && <button type="button" onClick={() => removeRow(idx)} className="btn-ghost p-1 text-red-500"><Trash2 className="w-4 h-4" /></button>}</td>
              </tr>))}</tbody></table></div>
            <div className="p-4 border-t border-[var(--color-border)] text-right"><p className="text-lg font-semibold">Total: <span className="font-data text-[var(--color-primary)]">৳{total.toLocaleString()}</span></p></div>
          </div>
          <div className="flex justify-end gap-3"><button type="button" onClick={() => navigate(`${base}/inventory/gr`)} className="btn-secondary">Cancel</button><button type="submit" disabled={saving} className="btn-primary"><Save className="w-4 h-4 mr-1 inline" /> {saving ? 'Saving…' : 'Create GRN'}</button></div>
        </form>
      </div>
    </DashboardLayout>
  );
}
