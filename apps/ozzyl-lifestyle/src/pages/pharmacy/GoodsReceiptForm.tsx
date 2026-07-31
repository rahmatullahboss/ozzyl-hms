import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Plus, Trash2 } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

interface Supplier { id: number; name: string; }
interface PO { id: number; po_no: string; }
interface Item { id: number; name: string; }
interface GRNLine {
  itemId: string; batchNo: string; mfgDate: string; expiryDate: string;
  receivedQty: string; freeQty: string; rejectedQty: string;
  itemRate: string; mrp: string; salePrice: string;
  discountPct: string; vatPct: string;
}

const EMPTY_LINE: GRNLine = {
  itemId: '', batchNo: '', mfgDate: '', expiryDate: '',
  receivedQty: '1', freeQty: '0', rejectedQty: '0',
  itemRate: '0', mrp: '0', salePrice: '0',
  discountPct: '0', vatPct: '0',
};

export default function GoodsReceiptForm({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [pos, setPOs] = useState<PO[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    supplierId: '', poId: '', grnDate: new Date().toISOString().split('T')[0],
    invoiceNo: '', supplierBillDate: '', creditPeriod: '0',
    discountPct: '0', discountAmount: '0', vatPct: '0', adjustment: '0',
    remarks: '',
  });
  const [lines, setLines] = useState<GRNLine[]>([{ ...EMPTY_LINE }]);

  useEffect(() => {
    const token = localStorage.getItem('hms_token');
    const headers = { Authorization: `Bearer ${token}` };
    Promise.allSettled([
      axios.get('/api/pharmacy/pharmacy-suppliers', { headers }),
      axios.get('/api/pharmacy/purchase-orders', { params: { status: 'pending' }, headers }),
      axios.get('/api/pharmacy/items', { headers }),
    ]).then(([sRes, poRes, iRes]) => {
      if (sRes.status === 'fulfilled') setSuppliers(sRes.value.data.suppliers ?? []);
      if (poRes.status === 'fulfilled') setPOs(poRes.value.data.purchaseOrders ?? []);
      if (iRes.status === 'fulfilled') setItems(iRes.value.data.items ?? []);
    });
  }, []);

  const updateLine = (i: number, field: keyof GRNLine, val: string) =>
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l));

  const total = lines.reduce((s, l) => s + (parseFloat(l.receivedQty) || 0) * (parseFloat(l.itemRate) || 0), 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.supplierId) { toast.error(t('selectSupplier', { defaultValue: 'Please select a supplier' })); return; }
    const validLines = lines.filter(l => l.itemId && l.batchNo && parseFloat(l.receivedQty) > 0);
    if (validLines.length === 0) { toast.error(t('addItem', { defaultValue: 'Add at least one item with batch number' })); return; }
    setSaving(true);
    try {
      const token = localStorage.getItem('hms_token');
      await axios.post('/api/pharmacy/goods-receipts', {
        supplierId: parseInt(form.supplierId),
        poId: form.poId ? parseInt(form.poId) : undefined,
        invoiceNo: form.invoiceNo || undefined,
        grnDate: form.grnDate,
        supplierBillDate: form.supplierBillDate || undefined,
        discountPct: parseFloat(form.discountPct) || 0,
        discountAmount: Math.round((parseFloat(form.discountAmount) || 0) * 100),
        vatPct: parseFloat(form.vatPct) || 0,
        adjustment: Math.round((parseFloat(form.adjustment) || 0) * 100),
        creditPeriod: parseInt(form.creditPeriod) || 0,
        isItemDiscountApplicable: false,
        remarks: form.remarks || undefined,
        items: validLines.map(l => ({
          itemId: parseInt(l.itemId),
          batchNo: l.batchNo,
          expiryDate: l.expiryDate || undefined,
          manufactureDate: l.mfgDate || undefined,
          receivedQty: parseFloat(l.receivedQty),
          freeQty: parseFloat(l.freeQty) || 0,
          rejectedQty: parseFloat(l.rejectedQty) || 0,
          itemRate: Math.round(parseFloat(l.itemRate) * 100),
          mrp: Math.round(parseFloat(l.mrp) * 100),
          salePrice: Math.round(parseFloat(l.salePrice) * 100),
          discountPct: parseFloat(l.discountPct) || 0,
          vatPct: parseFloat(l.vatPct) || 0,
        })),
      }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(t('grnCreated', { defaultValue: 'Goods receipt created — stock updated' }));
      navigate(-1);
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error ?? err.response?.data?.message : 'Failed to create GRN';
      toast.error(msg || t('pharmacy.operationFailed'));
    } finally { setSaving(false); }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-5xl mx-auto">
        <div className="page-header"><div><h1 className="page-title">{t('receiveGoods', { defaultValue: 'Receive Goods (GRN)' })}</h1></div></div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="card p-5 space-y-4">
            <h3 className="font-semibold text-base">{t('receiptDetails', { defaultValue: 'Receipt Details' })}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div><label className="label">{t('supplier', { defaultValue: 'Supplier' })} *</label>
                <select className="input" required value={form.supplierId} onChange={e => setForm({...form, supplierId: e.target.value})}>
                  <option value="">{t('selectSupplier', { defaultValue: 'Select supplier…' })}</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div><label className="label">{t('linkedPO', { defaultValue: 'Linked PO' })}</label>
                <select className="input" value={form.poId} onChange={e => setForm({...form, poId: e.target.value})}>
                  <option value="">{t('none', { defaultValue: 'None' })}</option>
                  {pos.map(p => <option key={p.id} value={p.id}>{p.po_no}</option>)}
                </select>
              </div>
              <div><label className="label">{t('grnDate', { defaultValue: 'GRN Date' })} *</label><input className="input" type="date" required value={form.grnDate} onChange={e => setForm({...form, grnDate: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div><label className="label">{t('supplierInvoiceNo', { defaultValue: 'Supplier Invoice No' })}</label><input className="input" value={form.invoiceNo} onChange={e => setForm({...form, invoiceNo: e.target.value})} /></div>
              <div><label className="label">{t('creditPeriod', { defaultValue: 'Credit Period (days)' })}</label><input className="input" type="number" min="0" value={form.creditPeriod} onChange={e => setForm({...form, creditPeriod: e.target.value})} /></div>
              <div><label className="label">{t('discountPct', { defaultValue: 'Discount %' })}</label><input className="input" type="number" min="0" max="100" step="0.01" value={form.discountPct} onChange={e => setForm({...form, discountPct: e.target.value})} /></div>
              <div><label className="label">{t('remarks', { defaultValue: 'Remarks' })}</label><input className="input" value={form.remarks} onChange={e => setForm({...form, remarks: e.target.value})} /></div>
            </div>
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-base">{t('batchItems', { defaultValue: 'Batch Items' })}</h3>
              <button type="button" onClick={() => setLines(prev => [...prev, {...EMPTY_LINE}])} className="btn-secondary text-sm"><Plus className="w-4 h-4" /> {t('addRow', { defaultValue: 'Add Row' })}</button>
            </div>
            <div className="space-y-3">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-start bg-[var(--color-surface)] p-3 rounded-lg">
                  <div className="col-span-2"><label className="label text-xs">{t('item', { defaultValue: 'Item' })}</label><select className="input text-sm" value={l.itemId} onChange={e => updateLine(i, 'itemId', e.target.value)}><option value="">Select…</option>{items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}</select></div>
                  <div className="col-span-2"><label className="label text-xs">{t('batchNo', { defaultValue: 'Batch No' })} *</label><input className="input text-sm" placeholder="B-001" required value={l.batchNo} onChange={e => updateLine(i, 'batchNo', e.target.value)} /></div>
                  <div className="col-span-1"><label className="label text-xs">{t('expiry', { defaultValue: 'Expiry' })}</label><input className="input text-sm" type="date" value={l.expiryDate} onChange={e => updateLine(i, 'expiryDate', e.target.value)} /></div>
                  <div className="col-span-1"><label className="label text-xs">{t('qty', { defaultValue: 'Qty' })}</label><input className="input text-sm" type="number" min="1" value={l.receivedQty} onChange={e => updateLine(i, 'receivedQty', e.target.value)} /></div>
                  <div className="col-span-1"><label className="label text-xs">{t('costPrice', { defaultValue: 'Cost ৳' })}</label><input className="input text-sm" type="number" min="0" step="0.01" value={l.itemRate} onChange={e => updateLine(i, 'itemRate', e.target.value)} /></div>
                  <div className="col-span-1"><label className="label text-xs">{t("pharmacy.mrpBdt")}</label><input className="input text-sm" type="number" min="0" step="0.01" value={l.mrp} onChange={e => updateLine(i, 'mrp', e.target.value)} /></div>
                  <div className="col-span-1"><label className="label text-xs">{t('salePrice', { defaultValue: 'Sale ৳' })}</label><input className="input text-sm" type="number" min="0" step="0.01" value={l.salePrice} onChange={e => updateLine(i, 'salePrice', e.target.value)} /></div>
                  <div className="col-span-1"><label className="label text-xs">{t('freeQty', { defaultValue: 'Free' })}</label><input className="input text-sm" type="number" min="0" value={l.freeQty} onChange={e => updateLine(i, 'freeQty', e.target.value)} /></div>
                  <div className="col-span-1"><label className="label text-xs">{t('vatPct', { defaultValue: 'VAT%' })}</label><input className="input text-sm" type="number" min="0" max="100" step="0.01" value={l.vatPct} onChange={e => updateLine(i, 'vatPct', e.target.value)} /></div>
                  <div className="col-span-1 flex items-end pb-1"><button type="button" onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))} className="btn-ghost p-1.5 text-red-500" disabled={lines.length === 1}><Trash2 className="w-4 h-4" /></button></div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-[var(--color-border)] flex justify-end">
              <div className="text-right"><p className="text-sm text-[var(--color-text-muted)]">{t('total', { defaultValue: 'Total' })}</p><p className="text-xl font-bold font-data">৳{total.toLocaleString()}</p></div>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => navigate(-1)} className="btn-secondary">{t('cancel', { ns: 'common', defaultValue: 'Cancel' })}</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? t('receiving', { defaultValue: 'Receiving…' }) : t('createGRN', { defaultValue: 'Create GRN & Update Stock' })}</button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}
