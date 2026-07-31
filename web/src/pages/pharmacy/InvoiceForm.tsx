import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { Plus, Trash2, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { api } from '../../lib/apiClient';
import { formatDisplayDate } from '../../lib/date-utils';

interface StockBatch {
  id: number; item_id: number; item_name?: string; medicine_name?: string;
  batch_no: string; available_qty: number; mrp: number; sale_price: number;
  expiry_date?: string; cost_price: number;
}

interface InvoiceLine {
  stockId: string; itemId: number; itemName: string; batchNo: string;
  expiryDate: string; qty: string; mrp: number; unitPrice: string;
  discount: string; vatPct: string; availableQty: number;
}

export default function InvoiceForm({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [stockSearch, setStockSearch] = useState('');
  const [stockResults, setStockResults] = useState<StockBatch[]>([]);
  const [searching, setSearching] = useState(false);

  const [form, setForm] = useState({
    patientId: '', patientName: '', invoiceDate: new Date().toISOString().split('T')[0],
    paymentMode: 'cash', paidAmount: '', creditAmount: '0', depositDeducted: '0',
    tender: '0', remarks: '',
  });
  const [lines, setLines] = useState<InvoiceLine[]>([]);

  const searchStock = useCallback(async (q: string) => {
    if (!q.trim()) { setStockResults([]); return; }
    setSearching(true);
    try {
      const data = await api.get<{ stock: StockBatch[] }>('/api/pharmacy/stock');
      // Client-side filter since backend doesn't support search param
      const all: StockBatch[] = data.stock ?? [];
      const lower = q.toLowerCase();
      setStockResults(all.filter(b =>
        (b.item_name ?? '').toLowerCase().includes(lower) ||
        (b.medicine_name ?? '').toLowerCase().includes(lower) ||
        (b.batch_no ?? '').toLowerCase().includes(lower)
      ).slice(0, 20));
    } catch { setStockResults([]); } finally { setSearching(false); }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => searchStock(stockSearch), 400);
    return () => clearTimeout(timer);
  }, [stockSearch, searchStock]);

  const addBatch = (batch: StockBatch) => {
    const exists = lines.find(l => l.stockId === String(batch.id));
    if (exists) { toast.error(t('alreadyAdded')); return; }
    const newLine: InvoiceLine = {
      stockId: String(batch.id),
      itemId: batch.item_id,
      itemName: batch.medicine_name || batch.item_name || '',
      batchNo: batch.batch_no,
      expiryDate: batch.expiry_date ?? '',
      qty: '1',
      mrp: batch.mrp ?? 0,
      unitPrice: String((batch.sale_price ?? batch.mrp ?? 0) / 100),
      discount: '0',
      vatPct: '0',
      availableQty: batch.available_qty,
    };
    setLines(prev => [...prev, newLine]);
    setStockSearch(''); setStockResults([]);
  };

  const updateLine = (i: number, field: keyof InvoiceLine, val: string) =>
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l));

  const subtotal = lines.reduce((s, l) => {
    const amt = (parseFloat(l.qty) || 0) * (parseFloat(l.unitPrice) || 0);
    const disc = (amt * (parseFloat(l.discount) || 0)) / 100;
    return s + amt - disc;
  }, 0);

  const createInvoice = useApiMutation<unknown, unknown>(
    'post',
    '/api/pharmacy/invoices',
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.pharmacy.invoices() });
        queryClient.invalidateQueries({ queryKey: queryKeys.pharmacy.stock() });
        toast.success(t('invoiceCreated'));
        navigate(-1);
      },
      onError: (err) => {
        toast.error(err.message || t('operationFailed', { ns: 'common' }));
      },
    },
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lines.length === 0) { toast.error(t('addItem')); return; }

    // F10 fix: Client-side available_qty validation
    for (const line of lines) {
      const qty = parseFloat(line.qty) || 0;
      if (qty > line.availableQty) {
        toast.error(t('invoice.qtyExceeds', { name: line.itemName, qty, avail: line.availableQty }));
        return;
      }
    }

    const paidAmt = parseFloat(form.paidAmount) || 0;
    const creditAmt = parseFloat(form.creditAmount) || 0;
    const depositDeducted = parseFloat(form.depositDeducted) || 0;
    if (Math.abs((paidAmt + creditAmt + depositDeducted) - subtotal) > 0.01) {
      toast.error(t('invoice.paymentMismatch', { paid: paidAmt, credit: creditAmt, deposit: depositDeducted, total: subtotal.toFixed(2) }));
      return;
    }

    const tenderAmt = parseFloat(form.tender) || paidAmt;
    createInvoice.mutate({
      patientId: form.patientId ? parseInt(form.patientId) : undefined,
      isOutdoorPatient: true,
      discountAmount: 0,
      discountPct: 0,
      vatAmount: 0,
      paidAmount: Math.round(paidAmt * 100),
      creditAmount: Math.round(creditAmt * 100),
      tender: Math.round(tenderAmt * 100),
      paymentMode: form.paymentMode as 'cash' | 'card' | 'credit' | 'mobile' | 'deposit',
      depositDeductAmount: Math.round(depositDeducted * 100),
      remarks: form.remarks || undefined,
      items: lines.map(l => ({
        itemId: l.itemId,
        stockId: parseInt(l.stockId),
        batchNo: l.batchNo,
        expiryDate: l.expiryDate || undefined,
        quantity: parseFloat(l.qty),
        mrp: l.mrp,
        price: Math.round(parseFloat(l.unitPrice) * 100),
        discountPct: parseFloat(l.discount) || 0,
        vatPct: parseFloat(l.vatPct) || 0,
      })),
    });
  };

  const saving = createInvoice.isPending;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-5xl mx-auto">
        <div className="page-header"><h1 className="page-title">{t('newInvoice')}</h1></div>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Patient & Date */}
          <div className="card p-5 space-y-4">
            <h3 className="font-semibold">{t('patientInfo')}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div><label className="label">{t('patientName')}</label><input className="input" value={form.patientName} onChange={e => setForm({...form, patientName: e.target.value})} placeholder={t('walkInCustomer')} /></div>
              <div><label className="label">{t('invoiceDate')} *</label><input className="input" type="date" required value={form.invoiceDate} onChange={e => setForm({...form, invoiceDate: e.target.value})} /></div>
              <div><label className="label">{t('remarks', { ns: 'common' })}</label><input className="input" value={form.remarks} onChange={e => setForm({...form, remarks: e.target.value})} /></div>
            </div>
          </div>

          {/* Item Search */}
          <div className="card p-5">
            <h3 className="font-semibold mb-3">{t('addItemsSearch')}</h3>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
              <input className="input pl-9" placeholder={t('searchStockPlaceholder')} value={stockSearch} onChange={e => setStockSearch(e.target.value)} />
            </div>
            {stockResults.length > 0 && (
              <div className="mt-2 border border-[var(--color-border)] rounded-xl overflow-hidden shadow-lg max-h-56 overflow-y-auto">
                {stockResults.map(b => (
                  <button key={b.id} type="button" onClick={() => addBatch(b)}
                    className="w-full px-4 py-2.5 text-left hover:bg-[var(--color-primary-light)] transition-colors flex items-center justify-between border-b border-[var(--color-border)] last:border-0">
                    <div>
                      <span className="font-medium text-sm">{b.medicine_name || b.item_name}</span>
                      <span className="ml-2 text-xs text-[var(--color-text-muted)] font-mono">Batch: {b.batch_no}</span>
                      {b.expiry_date && <span className="ml-2 text-xs text-amber-600">Exp: {formatDisplayDate(b.expiry_date)}</span>}
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <span className="text-sm font-data">৳{((b.sale_price ?? b.mrp ?? 0) / 100).toFixed(2)}</span>
                      <span className="text-xs text-[var(--color-text-muted)] ml-2">Avail: {b.available_qty}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {searching && <p className="text-sm text-[var(--color-text-muted)] mt-2">{t('searching', { defaultValue: 'Searching…' })}</p>}
          </div>

          {/* Line Items */}
          <div className="card p-5">
            <h3 className="font-semibold mb-3">{t('invoiceLines', { defaultValue: 'Invoice Lines' })}</h3>
            <div className="space-y-2">
              {lines.length === 0 ? (
                <div className="text-sm text-[var(--color-text-muted)] py-6 px-3 bg-[var(--color-surface)] rounded-lg flex items-center justify-center gap-2">
                  <Plus className="w-4 h-4" /> {t('searchToAdd', { defaultValue: 'Search and click an item above to add it here' })}
                </div>
              ) : lines.map((l, i) => {
                const lineTotal = (parseFloat(l.qty) || 0) * (parseFloat(l.unitPrice) || 0) * (1 - (parseFloat(l.discount) || 0) / 100);
                const qtyExceeds = (parseFloat(l.qty) || 0) > l.availableQty;
                return (
                  <div key={i} className={`grid grid-cols-12 gap-2 items-center p-2 rounded-lg ${qtyExceeds ? 'bg-red-50 dark:bg-red-900/20 border border-red-300' : 'bg-[var(--color-surface)]'}`}>
                    <div className="col-span-3">
                      <span className="text-sm font-medium">{l.itemName}</span>
                      <span className="block text-xs text-[var(--color-text-muted)] font-mono">{l.batchNo} | Avail: {l.availableQty}</span>
                    </div>
                    <div className="col-span-2"><input className="input text-sm" type="number" min="1" max={l.availableQty} placeholder={t('qty', { defaultValue: 'Qty' })} value={l.qty} onChange={e => updateLine(i, 'qty', e.target.value)} /></div>
                    <div className="col-span-2"><input className="input text-sm" type="number" min="0" step="0.01" placeholder={t('priceBadge', { defaultValue: 'Price ৳' })} value={l.unitPrice} onChange={e => updateLine(i, 'unitPrice', e.target.value)} /></div>
                    <div className="col-span-2"><input className="input text-sm" type="number" min="0" max="100" step="0.1" placeholder={t('discPercent', { defaultValue: 'Disc %' })} value={l.discount} onChange={e => updateLine(i, 'discount', e.target.value)} /></div>
                    <div className="col-span-2 text-right font-data text-sm">৳{lineTotal.toFixed(2)}</div>
                    <div className="col-span-1 text-right"><button type="button" onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))} className="btn-ghost p-1.5 text-red-500"><Trash2 className="w-4 h-4" /></button></div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-[var(--color-border)] flex justify-end">
              <div className="text-right"><p className="text-sm text-[var(--color-text-muted)]">{t('subtotal', { defaultValue: 'Subtotal' })}</p><p className="text-2xl font-bold font-data text-[var(--color-primary)]">৳{subtotal.toLocaleString()}</p></div>
            </div>
          </div>

          {/* Payment */}
          <div className="card p-5 space-y-4">
            <h3 className="font-semibold">{t('payment', { defaultValue: 'Payment' })}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div><label className="label">{t('paymentMode', { defaultValue: 'Payment Mode' })}</label>
                <select className="input" value={form.paymentMode} onChange={e => setForm({...form, paymentMode: e.target.value})}>
                  {['cash', 'card', 'mobile', 'credit', 'deposit'].map(m => <option key={m} value={m}>{t(`paymentModes.${m}`, { defaultValue: m.charAt(0).toUpperCase() + m.slice(1) })}</option>)}
                </select>
              </div>
              <div><label className="label">{t('paidAmount', { defaultValue: 'Paid Amount ৳' })}</label><input className="input" type="number" min="0" step="0.01" value={form.paidAmount} onChange={e => setForm({...form, paidAmount: e.target.value})} placeholder={subtotal.toFixed(2)} /></div>
              <div><label className="label">{t('creditAmount', { defaultValue: 'Credit Amount ৳' })}</label><input className="input" type="number" min="0" step="0.01" value={form.creditAmount} onChange={e => setForm({...form, creditAmount: e.target.value})} /></div>
              <div><label className="label">{t('depositDeducted', { defaultValue: 'Deposit Deducted ৳' })}</label><input className="input" type="number" min="0" step="0.01" value={form.depositDeducted} onChange={e => setForm({...form, depositDeducted: e.target.value})} /></div>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">{t('paymentNote', { defaultValue: `Paid + Credit + Deposit must equal Total (৳${subtotal.toFixed(2)})` })}</p>
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => navigate(-1)} className="btn-secondary">{t('cancel', { ns: 'common', defaultValue: 'Cancel' })}</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? t('creating', { defaultValue: 'Creating…' }) : t('createInvoice', { defaultValue: 'Create Invoice & Deduct Stock' })}</button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}
