import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ShoppingCart, Plus, Trash2, Save } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

interface Vendor { VendorId: number; VendorName: string; }
interface Item { ItemId: number; ItemName: string; ItemCode: string; StandardRate: number; }
interface POItem { ItemId: number; ItemName: string; Quantity: number; ItemRate: number; VATPercent: number; VATAmount: number; TotalAmount: number; }

export default function PurchaseOrderForm({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['inventory', 'common']);
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const [saving, setSaving] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [form, setForm] = useState({ VendorId: '', Remarks: '', DeliveryDays: '7' });
  const [poItems, setPOItems] = useState<POItem[]>([{ ItemId: 0, ItemName: '', Quantity: 1, ItemRate: 0, VATPercent: 0, VATAmount: 0, TotalAmount: 0 }]);

  useEffect(() => {
    const token = localStorage.getItem('hms_token');
    const headers = { Authorization: `Bearer ${token}` };
    axios.get('/api/inventory/vendors', { params: { page: 1, limit: 100 }, headers }).then(r => setVendors(r.data.data ?? [])).catch(() => { toast.error('Failed to load vendors'); });
    axios.get('/api/inventory/items', { params: { page: 1, limit: 200 }, headers }).then(r => setItems(r.data.data ?? [])).catch(() => { toast.error('Failed to load items'); });
  }, []);

  const addRow = () => setPOItems(prev => [...prev, { ItemId: 0, ItemName: '', Quantity: 1, ItemRate: 0, VATPercent: 0, VATAmount: 0, TotalAmount: 0 }]);
  const removeRow = (idx: number) => setPOItems(prev => prev.filter((_, i) => i !== idx));

  const updateItem = (idx: number, field: string, value: any) => {
    setPOItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: value };
      if (field === 'ItemId') {
        const found = items.find(it => it.ItemId === Number(value));
        if (found) { updated.ItemName = found.ItemName; updated.ItemRate = found.StandardRate; }
      }
      updated.VATAmount = (updated.Quantity * updated.ItemRate * updated.VATPercent) / 100;
      updated.TotalAmount = updated.Quantity * updated.ItemRate + updated.VATAmount;
      return updated;
    }));
  };

  const subtotal = poItems.reduce((s, i) => s + i.Quantity * i.ItemRate, 0);
  const totalVAT = poItems.reduce((s, i) => s + i.VATAmount, 0);
  const grandTotal = subtotal + totalVAT;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.VendorId || poItems.some(i => !i.ItemId)) { toast.error(t('inventory.please_fill_all_required_fields')); return; }
    setSaving(true);
    try {
      const token = localStorage.getItem('hms_token');
      await axios.post('/api/inventory/purchase-orders', {
        VendorId: Number(form.VendorId), Remarks: form.Remarks, DeliveryDays: Number(form.DeliveryDays),
        SubTotal: subtotal, VATAmount: totalVAT, TotalAmount: grandTotal,
        Items: poItems.map(i => ({ ItemId: i.ItemId, Quantity: i.Quantity, StandardRate: i.ItemRate, VATPercent: i.VATPercent, VATAmount: i.VATAmount, TotalAmount: i.TotalAmount })),
      }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(t('inventory.purchase_order_created'));
      navigate(`${base}/inventory/po`);
    } catch (err: any) { toast.error(err?.response?.data?.error || t('inventory.createPurchaseOrderFailed')); }
    finally { setSaving(false); }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        <div className="page-header">
          <h1 className="page-title"><ShoppingCart className="w-6 h-6 inline mr-2" />{t('createPO', { defaultValue: 'Create Purchase Order' })}</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className="label">{t('inventory.vendor_')}</label>
              <select className="input" required value={form.VendorId} onChange={e => setForm({ ...form, VendorId: e.target.value })}>
                <option value="">Select vendor…</option>
                {vendors.map(v => <option key={v.VendorId} value={v.VendorId}>{v.VendorName}</option>)}
              </select></div>
            <div><label className="label">{t('inventory.delivery_days')}</label><input className="input" type="number" value={form.DeliveryDays} onChange={e => setForm({ ...form, DeliveryDays: e.target.value })} /></div>
            <div><label className="label">{t('inventory.remarks')}</label><input className="input" value={form.Remarks} onChange={e => setForm({ ...form, Remarks: e.target.value })} /></div>
          </div>

          <div className="card overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex justify-between items-center">
              <h3 className="font-semibold">Order Items</h3>
              <button type="button" onClick={addRow} className="btn-secondary text-sm"><Plus className="w-4 h-4 mr-1 inline" /> Add Item</button>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Item *</th><th>Qty *</th><th>Rate</th><th>VAT %</th><th>VAT Amt</th><th>Total</th><th></th></tr></thead>
                <tbody>
                  {poItems.map((item, idx) => (
                    <tr key={idx}>
                      <td><select className="input" value={item.ItemId} onChange={e => updateItem(idx, 'ItemId', e.target.value)} required>
                        <option value="">Select…</option>
                        {items.map(it => <option key={it.ItemId} value={it.ItemId}>{it.ItemName} ({it.ItemCode})</option>)}
                      </select></td>
                      <td><input className="input w-20" type="number" min="1" value={item.Quantity} onChange={e => updateItem(idx, 'Quantity', parseInt(e.target.value) || 0)} /></td>
                      <td><input className="input w-24" type="number" step="0.01" value={item.ItemRate} onChange={e => updateItem(idx, 'ItemRate', parseFloat(e.target.value) || 0)} /></td>
                      <td><input className="input w-20" type="number" step="0.01" value={item.VATPercent} onChange={e => updateItem(idx, 'VATPercent', parseFloat(e.target.value) || 0)} /></td>
                      <td className="font-data">৳{item.VATAmount.toFixed(2)}</td>
                      <td className="font-data font-semibold">৳{item.TotalAmount.toFixed(2)}</td>
                      <td>{poItems.length > 1 && <button type="button" onClick={() => removeRow(idx)} className="btn-ghost p-1 text-red-500"><Trash2 className="w-4 h-4" /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-[var(--color-border)] flex justify-end">
              <div className="text-right space-y-1">
                <p className="text-sm text-[var(--color-text-secondary)]">Subtotal: <span className="font-data font-semibold">৳{subtotal.toLocaleString()}</span></p>
                <p className="text-sm text-[var(--color-text-secondary)]">VAT: <span className="font-data">৳{totalVAT.toFixed(2)}</span></p>
                <p className="text-lg font-semibold">Grand Total: <span className="font-data text-[var(--color-primary)]">৳{grandTotal.toLocaleString()}</span></p>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => navigate(`${base}/inventory/po`)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary"><Save className="w-4 h-4 mr-1 inline" /> {saving ? 'Saving…' : 'Create Purchase Order'}</button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}
