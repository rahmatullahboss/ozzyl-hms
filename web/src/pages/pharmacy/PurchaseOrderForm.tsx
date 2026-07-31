import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

interface Supplier { id: number; name: string; }
interface Item { id: number; name: string; }
interface POItem { itemId: string; itemName: string; quantity: string; standardRate: string; vatAmount: string; remarks: string; }

export default function PurchaseOrderForm({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    supplierId: '', poDate: new Date().toISOString().split('T')[0],
    expectedDelivery: '', remarks: '', deliveryAddress: '',
    discountAmount: '0', discountPct: '0', vatAmount: '0', adjustment: '0',
  });
  const [lines, setLines] = useState<POItem[]>([{ itemId: '', itemName: '', quantity: '1', standardRate: '0', vatAmount: '0', remarks: '' }]);

  // Quick-add supplier modal
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [supplierForm, setSupplierForm] = useState({ name: '', contactNo: '', email: '', city: '' });

  const { data: suppliersData, refetch: refetchSuppliers } = useApiQuery<{ suppliers: Supplier[] }>(
    queryKeys.pharmacy.suppliers(),
    '/api/pharmacy/pharmacy-suppliers',
  );
  const { data: itemsData } = useApiQuery<{ items: Item[] }>(
    queryKeys.pharmacy.items(),
    '/api/pharmacy/items',
  );

  const suppliers = suppliersData?.suppliers ?? [];
  const items = itemsData?.items ?? [];

  const addLine = () => setLines(prev => [...prev, { itemId: '', itemName: '', quantity: '1', standardRate: '0', vatAmount: '0', remarks: '' }]);
  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: keyof POItem, val: string) => {
    setLines(prev => prev.map((l, idx) => {
      if (idx !== i) return l;
      if (field === 'itemId') {
        const found = items.find(it => String(it.id) === val);
        return { ...l, itemId: val, itemName: found?.name ?? '' };
      }
      return { ...l, [field]: val };
    }));
  };

  const total = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.standardRate) || 0), 0);

  const createPO = useApiMutation<unknown, unknown>(
    'post',
    '/api/pharmacy/purchase-orders',
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.pharmacy.purchaseOrders() });
        toast.success(t('poCreated', { defaultValue: 'Purchase order created' }));
        navigate(-1);
      },
      onError: (err) => {
        toast.error(err.message || t('po.failed', { defaultValue: 'Failed' }));
      },
    },
  );

  const createSupplier = useApiMutation<{ id?: number }, unknown>(
    'post',
    '/api/pharmacy/pharmacy-suppliers',
    {
      onSuccess: async (data) => {
        toast.success(t('supplier.created', { defaultValue: 'Supplier created' }));
        setShowSupplierModal(false);
        setSupplierForm({ name: '', contactNo: '', email: '', city: '' });
        await refetchSuppliers();
        if (data.id) setForm(prev => ({ ...prev, supplierId: String(data.id) }));
      },
      onError: (err) => {
        toast.error(err.message || t('supplier.failedCreate', { defaultValue: 'Failed' }));
      },
    },
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.supplierId) { toast.error(t('selectSupplier', { defaultValue: 'Please select a supplier' })); return; }
    const validLines = lines.filter(l => l.itemId && parseFloat(l.quantity) > 0);
    if (validLines.length === 0) { toast.error(t('addItem', { defaultValue: 'Add at least one item' })); return; }

    createPO.mutate({
      supplierId: parseInt(form.supplierId),
      poDate: form.poDate,
      deliveryDate: form.expectedDelivery || undefined,
      deliveryAddress: form.deliveryAddress || undefined,
      discountAmount: Math.round((parseFloat(form.discountAmount) || 0) * 100),
      discountPct: parseFloat(form.discountPct) || 0,
      vatAmount: Math.round((parseFloat(form.vatAmount) || 0) * 100),
      adjustment: Math.round((parseFloat(form.adjustment) || 0) * 100),
      remarks: form.remarks || undefined,
      items: validLines.map(l => ({
        itemId: parseInt(l.itemId),
        quantity: parseFloat(l.quantity),
        standardRate: Math.round(parseFloat(l.standardRate) * 100),
        vatAmount: Math.round((parseFloat(l.vatAmount) || 0) * 100),
        remarks: l.remarks || undefined,
      })),
    });
  };

  const handleQuickAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierForm.name.trim()) { toast.error(t('supplier.nameRequired', { defaultValue: 'Supplier name required' })); return; }
    createSupplier.mutate({
      name: supplierForm.name,
      contactNo: supplierForm.contactNo || undefined,
      email: supplierForm.email || undefined,
      city: supplierForm.city || undefined,
    });
  };

  const saving = createPO.isPending;
  const supplierSaving = createSupplier.isPending;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-4xl mx-auto">
        <div className="page-header">
          <div><h1 className="page-title">{t('createPO', { defaultValue: 'Create Purchase Order' })}</h1></div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="card p-5 space-y-4">
            <h3 className="font-semibold text-base">{t('orderDetails', { defaultValue: 'Order Details' })}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-1">
                <label className="label">{t('supplier', { defaultValue: 'Supplier' })} *</label>
                <div className="flex gap-2">
                  <select className="input flex-1" required value={form.supplierId} onChange={e => setForm({...form, supplierId: e.target.value})}>
                    <option value="">{t('selectSupplier', { defaultValue: 'Select supplier…' })}</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button type="button" onClick={() => setShowSupplierModal(true)}
                    className="btn-secondary px-2.5 shrink-0" title={t('quickAddSupplier', { defaultValue: 'Quick add supplier' })}>
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div><label className="label">{t('poDate', { defaultValue: 'PO Date' })} *</label><input className="input" type="date" required value={form.poDate} onChange={e => setForm({...form, poDate: e.target.value})} /></div>
              <div><label className="label">{t('expectedDelivery', { defaultValue: 'Expected Delivery' })}</label><input className="input" type="date" value={form.expectedDelivery} onChange={e => setForm({...form, expectedDelivery: e.target.value})} /></div>
            </div>
            <div><label className="label">{t('remarks', { defaultValue: 'Remarks' })}</label><textarea className="input" rows={2} value={form.remarks} onChange={e => setForm({...form, remarks: e.target.value})} /></div>
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-base">{t('items', { defaultValue: 'Items' })}</h3>
              <button type="button" onClick={addLine} className="btn-secondary text-sm"><Plus className="w-4 h-4" /> {t('addRow', { defaultValue: 'Add Row' })}</button>
            </div>
            <div className="space-y-3">
              {lines.map((line, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-5">
                    <select className="input" value={line.itemId} onChange={e => updateLine(i, 'itemId', e.target.value)}>
                      <option value="">{t('selectItem', { defaultValue: 'Select item…' })}</option>
                      {items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
                    </select>
                  </div>
                  <div className="col-span-3"><input className="input" type="number" min="1" placeholder={t('qty', { defaultValue: 'Qty' })} value={line.quantity} onChange={e => updateLine(i, 'quantity', e.target.value)} /></div>
                  <div className="col-span-3"><input className="input" type="number" min="0" step="0.01" placeholder={t('unitPrice', { defaultValue: 'Unit Price ৳' })} value={line.standardRate} onChange={e => updateLine(i, 'standardRate', e.target.value)} /></div>
                  <div className="col-span-1 text-right"><button type="button" onClick={() => removeLine(i)} className="btn-ghost p-1.5 text-red-500" disabled={lines.length === 1}><Trash2 className="w-4 h-4" /></button></div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-[var(--color-border)] flex justify-end">
              <div className="text-right"><p className="text-sm text-[var(--color-text-muted)]">{t('total', { defaultValue: 'Total' })}</p><p className="text-xl font-bold font-data">৳{total.toLocaleString()}</p></div>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => navigate(-1)} className="btn-secondary">{t('cancel', { ns: 'common', defaultValue: 'Cancel' })}</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? t('creating', { defaultValue: 'Creating…' }) : t('createPO', { defaultValue: 'Create Purchase Order' })}</button>
          </div>
        </form>

        {/* Quick-Add Supplier Modal */}
        {showSupplierModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-sm">
              <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{t('quickAddSupplier', { defaultValue: 'Quick Add Supplier' })}</h3>
                <button onClick={() => setShowSupplierModal(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleQuickAddSupplier} className="p-4 space-y-3">
                <div><label className="label">{t('supplierName', { defaultValue: 'Supplier Name' })} *</label><input className="input" required value={supplierForm.name} onChange={e => setSupplierForm({...supplierForm, name: e.target.value})} placeholder={t('supplier.namePlaceholderShort', { defaultValue: 'e.g. Square Pharmaceuticals' })} autoFocus /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label">{t('contactNo', { defaultValue: 'Contact No' })}</label><input className="input" value={supplierForm.contactNo} onChange={e => setSupplierForm({...supplierForm, contactNo: e.target.value})} placeholder={t('supplier.contactPlaceholder', { defaultValue: '01712xxxxxx' })} /></div>
                  <div><label className="label">{t('city', { defaultValue: 'City' })}</label><input className="input" value={supplierForm.city} onChange={e => setSupplierForm({...supplierForm, city: e.target.value})} placeholder={t('supplier.cityPlaceholder', { defaultValue: 'Dhaka' })} /></div>
                </div>
                <div><label className="label">{t('email', { defaultValue: 'Email' })}</label><input className="input" type="email" value={supplierForm.email} onChange={e => setSupplierForm({...supplierForm, email: e.target.value})} /></div>
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={() => setShowSupplierModal(false)} className="btn-secondary text-sm">{t('cancel', { ns: 'common', defaultValue: 'Cancel' })}</button>
                  <button type="submit" disabled={supplierSaving} className="btn-primary text-sm">{supplierSaving ? '…' : t('addSupplier', { defaultValue: 'Add Supplier' })}</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
