import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ClipboardList, Plus, Trash2, Save } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

interface Item { ItemId: number; ItemName: string; ItemCode: string; }
interface GRItem { ItemId: number; BatchNo: string; ExpiryDate: string; ReceivedQuantity: number; ItemRate: number; MRP: number; VATPercent: number; TotalAmount: number; }

export default function GoodsReceiptForm({ role = 'hospital_admin' }: { role?: string }) {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [form, setForm] = useState({ VendorBillNo: '', VendorBillDate: '', PaymentMode: 'credit', Remarks: '' });
  const [grItems, setGRItems] = useState<GRItem[]>([{ ItemId: 0, BatchNo: '', ExpiryDate: '', ReceivedQuantity: 1, ItemRate: 0, MRP: 0, VATPercent: 0, TotalAmount: 0 }]);

  useEffect(() => {
    const token = localStorage.getItem('hms_token');
    axios.get('/api/inventory/items', { params: { page: 1, limit: 200 }, headers: { Authorization: `Bearer ${token}` } }).then(r => setItems(r.data.data ?? [])).catch(() => { toast.error('Failed to load items'); });
  }, []);

  const addRow = () => setGRItems(prev => [...prev, { ItemId: 0, BatchNo: '', ExpiryDate: '', ReceivedQuantity: 1, ItemRate: 0, MRP: 0, VATPercent: 0, TotalAmount: 0 }]);
  const removeRow = (idx: number) => setGRItems(prev => prev.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: string, value: any) => {
    setGRItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const u = { ...item, [field]: value };
      u.TotalAmount = u.ReceivedQuantity * u.ItemRate * (1 + u.VATPercent / 100);
      return u;
    }));
  };

  const total = grItems.reduce((s, i) => s + i.TotalAmount, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const token = localStorage.getItem('hms_token');
      await axios.post('/api/inventory/goods-receipts', { ...form, TotalAmount: total, Items: grItems }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(t('inventory.goods_receipt_created')); navigate(`${base}/inventory/gr`);
    } catch (err: any) { toast.error(err?.response?.data?.error || t('inventory.createGrnFailed')); }
    finally { setSaving(false); }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        <div className="page-header"><h1 className="page-title"><ClipboardList className="w-6 h-6 inline mr-2" />New Goods Receipt</h1></div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="card p-5 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div><label className="label">{t('inventory.vendor_bill_no')}</label><input className="input" value={form.VendorBillNo} onChange={e => setForm({...form, VendorBillNo: e.target.value})} /></div>
            <div><label className="label">{t('inventory.bill_date')}</label><input className="input" type="date" value={form.VendorBillDate} onChange={e => setForm({...form, VendorBillDate: e.target.value})} /></div>
            <div><label className="label">{t('inventory.payment_mode')}</label><select className="input" value={form.PaymentMode} onChange={e => setForm({...form, PaymentMode: e.target.value})}><option value="cash">Cash</option><option value="credit">Credit</option><option value="cheque">Cheque</option></select></div>
            <div><label className="label">{t('inventory.remarks')}</label><input className="input" value={form.Remarks} onChange={e => setForm({...form, Remarks: e.target.value})} /></div>
          </div>
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex justify-between items-center"><h3 className="font-semibold">Receipt Items</h3><button type="button" onClick={addRow} className="btn-secondary text-sm"><Plus className="w-4 h-4 mr-1 inline" /> Add</button></div>
            <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Item *</th><th>Batch</th><th>Expiry</th><th>Qty *</th><th>Rate *</th><th>MRP</th><th>VAT%</th><th>Total</th><th></th></tr></thead><tbody>{grItems.map((item, idx) => (
              <tr key={idx}>
                <td><select className="input" value={item.ItemId} onChange={e => updateItem(idx, 'ItemId', Number(e.target.value))} required><option value="">Select…</option>{items.map(it => <option key={it.ItemId} value={it.ItemId}>{it.ItemName}</option>)}</select></td>
                <td><input className="input w-24" value={item.BatchNo} onChange={e => updateItem(idx, 'BatchNo', e.target.value)} /></td>
                <td><input className="input w-32" type="date" value={item.ExpiryDate} onChange={e => updateItem(idx, 'ExpiryDate', e.target.value)} /></td>
                <td><input className="input w-20" type="number" min="1" value={item.ReceivedQuantity} onChange={e => updateItem(idx, 'ReceivedQuantity', parseInt(e.target.value)||0)} /></td>
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
