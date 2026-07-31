import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { FileText, Plus, Send, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

type Tab = 'rfq' | 'quotations';

interface Vendor { VendorId: number; VendorName: string; }
interface Item { ItemId: number; ItemName: string; }
interface RFQ { RFQId: number; RFQNo: string; Subject: string; Status: string; RequestedCloseDate?: string; CreatedOn?: string; }
interface Quotation { QuotationId: number; QuotationNo: string; RFQId: number; VendorId: number; Status: string; QuotationDate?: string; }

interface RFQItemRow { ItemId: number; Quantity: number; Description: string; }
interface QuoteItemRow { ItemId: number; QuotedQuantity: number; QuotedRate: number; Description: string; }

export default function InventoryRFQPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['tenantPharmacy']);
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('rfq');

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title"><FileText className="w-6 h-6 inline mr-2" />{t('inventory.rfq.title')}</h1>
            <p className="section-subtitle">{t('inventory.rfq.subtitle')}</p>
          </div>
        </div>

        <div className="flex gap-2 border-b border-[var(--color-border)]">
          {([['rfq', t('inventory.rfq.rfqTab')], ['quotations', t('inventory.rfq.quotationsTab')]] as const).map(([key, label]) => (
            <button key={key} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === key ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`} onClick={() => setTab(key as Tab)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'rfq' && <RFQTab />}
        {tab === 'quotations' && <QuotationTab />}
      </div>
    </DashboardLayout>
  );
}

function RFQTab() {
  const { t } = useTranslation(['tenantPharmacy']);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ Subject: '', Description: '', RequestedCloseDate: '' });
  const [items, setItems] = useState<RFQItemRow[]>([{ ItemId: 0, Quantity: 1, Description: '' }]);
  const [vendorIds, setVendorIds] = useState<number[]>([]);

  const { data: rfqData } = useApiQuery<{ data: RFQ[] }>(['inventory', 'rfqs'], '/api/inventory/rfq?page=1&limit=20');
  const { data: vendorsData } = useApiQuery<{ data: Vendor[] }>(['inventory', 'vendors'], '/api/inventory/vendors?page=1&limit=100');
  const { data: itemsData } = useApiQuery<{ data: Item[] }>(['inventory', 'items-catalog'], '/api/inventory/items?page=1&limit=200');
  const rfqs = rfqData?.data ?? [];
  const vendors = vendorsData?.data ?? [];
  const catalog = itemsData?.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['inventory', 'rfqs'] });
  const createRFQ = useApiMutation<any, any>('post', '/api/inventory/rfq', {
    onSuccess: () => { toast.success(t('inventory.rfq.rfqCreated')); setShowForm(false); invalidate(); },
    onError: err => toast.error(err.message),
  });

  const submit = () => {
    if (!form.Subject) { toast.error(t('inventory.rfq.subjectRequired')); return; }
    const validItems = items.filter(i => i.ItemId && i.Quantity > 0);
    if (validItems.length === 0) { toast.error(t('inventory.rfq.addAtLeastOneItem')); return; }
    createRFQ.mutate({
      Subject: form.Subject,
      Description: form.Description || undefined,
      RequestedCloseDate: form.RequestedCloseDate || undefined,
      Items: validItems,
      VendorIds: vendorIds.length > 0 ? vendorIds : undefined,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary text-sm" onClick={() => setShowForm(!showForm)}><Plus className="w-4 h-4" /> {t('inventory.rfq.createRfq')}</button>
      </div>

      {showForm && (
        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className="label">{t('inventory.rfq.subject')}</label><input className="input" required value={form.Subject} onChange={e => setForm({ ...form, Subject: e.target.value })} /></div>
            <div><label className="label">{t('inventory.rfq.description')}</label><input className="input" value={form.Description} onChange={e => setForm({ ...form, Description: e.target.value })} /></div>
            <div><label className="label">{t('inventory.rfq.closeDate')}</label><input className="input" type="date" value={form.RequestedCloseDate} onChange={e => setForm({ ...form, RequestedCloseDate: e.target.value })} /></div>
          </div>

          <div>
            <h4 className="font-semibold text-sm mb-2">{t('inventory.rfq.items')}</h4>
            <table className="table-base"><thead><tr><th>{t('inventory.rfq.itemCol')}</th><th>{t('inventory.rfq.qtyCol')}</th><th>{t('inventory.rfq.descriptionCol')}</th><th></th></tr></thead>
              <tbody>{items.map((item, idx) => (
                <tr key={idx}>
                  <td><select className="input min-w-48" value={item.ItemId} onChange={e => setItems(prev => prev.map((r, i) => i === idx ? { ...r, ItemId: Number(e.target.value) } : r))}><option value="">{t('inventory.rfq.select')}</option>{catalog.map(i => <option key={i.ItemId} value={i.ItemId}>{i.ItemName}</option>)}</select></td>
                  <td><input className="input w-20" type="number" min="1" value={item.Quantity} onChange={e => setItems(prev => prev.map((r, i) => i === idx ? { ...r, Quantity: Number(e.target.value) } : r))} /></td>
                  <td><input className="input w-48" value={item.Description} onChange={e => setItems(prev => prev.map((r, i) => i === idx ? { ...r, Description: e.target.value } : r))} /></td>
                  <td>{items.length > 1 && <button className="btn-ghost p-1 text-red-500" onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}><Trash2 className="w-4 h-4" /></button>}</td>
                </tr>
              ))}</tbody>
            </table>
            <button className="btn-secondary text-sm mt-2" onClick={() => setItems(prev => [...prev, { ItemId: 0, Quantity: 1, Description: '' }])}><Plus className="w-4 h-4" /> {t('inventory.rfq.addItem')}</button>
          </div>

          <div>
            <h4 className="font-semibold text-sm mb-2">{t('inventory.rfq.inviteVendors')}</h4>
            <div className="flex flex-wrap gap-2">
              {vendors.map(v => (
                <label key={v.VendorId} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={vendorIds.includes(v.VendorId)} onChange={e => setVendorIds(prev => e.target.checked ? [...prev, v.VendorId] : prev.filter(id => id !== v.VendorId))} />
                  {v.VendorName}
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end"><button className="btn-primary" onClick={submit} disabled={createRFQ.isPending}><Send className="w-4 h-4" /> {createRFQ.isPending ? t('inventory.rfq.creating') : t('inventory.rfq.createRfq')}</button></div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>{t('inventory.rfq.rfqNo')}</th><th>{t('inventory.rfq.subjectCol')}</th><th>{t('inventory.rfq.closeDateCol')}</th><th>{t('inventory.rfq.status')}</th><th>{t('inventory.rfq.createdCol')}</th></tr></thead>
            <tbody>{rfqs.length === 0 ? <tr><td colSpan={5} className="text-center py-8 text-[var(--color-text-muted)]">{t('inventory.rfq.noRfqs')}</td></tr> : rfqs.map(rfq => (
              <tr key={rfq.RFQId}>
                <td className="font-medium">{rfq.RFQNo}</td>
                <td>{rfq.Subject}</td>
                <td>{rfq.RequestedCloseDate || '—'}</td>
                <td><span className={`badge ${rfq.Status === 'active' ? 'badge-success' : 'badge-secondary'}`}>{rfq.Status}</span></td>
                <td>{rfq.CreatedOn?.slice(0, 10) || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function QuotationTab() {
  const { t } = useTranslation(['tenantPharmacy']);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ RFQId: '', VendorId: '', QuotationDate: new Date().toISOString().slice(0, 10), Remarks: '' });
  const [items, setItems] = useState<QuoteItemRow[]>([{ ItemId: 0, QuotedQuantity: 1, QuotedRate: 0, Description: '' }]);

  const { data: quoteData } = useApiQuery<{ data: Quotation[] }>(['inventory', 'quotations'], '/api/inventory/rfq/quotation?page=1&limit=20');
  const { data: rfqData } = useApiQuery<{ data: RFQ[] }>(['inventory', 'rfqs'], '/api/inventory/rfq?page=1&limit=50');
  const { data: vendorsData } = useApiQuery<{ data: Vendor[] }>(['inventory', 'vendors'], '/api/inventory/vendors?page=1&limit=100');
  const { data: itemsData } = useApiQuery<{ data: Item[] }>(['inventory', 'items-catalog'], '/api/inventory/items?page=1&limit=200');
  const quotations = quoteData?.data ?? [];
  const rfqs = rfqData?.data ?? [];
  const vendors = vendorsData?.data ?? [];
  const catalog = itemsData?.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['inventory', 'quotations'] });
  const createQuote = useApiMutation<any, any>('post', '/api/inventory/rfq/quotation', {
    onSuccess: () => { toast.success(t('inventory.rfq.quotationSubmitted')); setShowForm(false); invalidate(); },
    onError: err => toast.error(err.message),
  });

  const submit = () => {
    if (!form.RFQId || !form.VendorId) { toast.error(t('inventory.rfq.rfqAndVendorRequired')); return; }
    const validItems = items.filter(i => i.ItemId && i.QuotedRate > 0);
    if (validItems.length === 0) { toast.error(t('inventory.rfq.addAtLeastOneItemWithRate')); return; }
    createQuote.mutate({
      RFQId: Number(form.RFQId),
      VendorId: Number(form.VendorId),
      QuotationDate: form.QuotationDate,
      Remarks: form.Remarks || undefined,
      Items: validItems,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary text-sm" onClick={() => setShowForm(!showForm)}><Plus className="w-4 h-4" /> {t('inventory.rfq.submitQuotation')}</button>
      </div>

      {showForm && (
        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div><label className="label">{t('inventory.rfq.rfq')}</label><select className="input" required value={form.RFQId} onChange={e => setForm({ ...form, RFQId: e.target.value })}><option value="">{t('inventory.rfq.selectRfq')}</option>{rfqs.map(r => <option key={r.RFQId} value={r.RFQId}>{r.RFQNo} — {r.Subject}</option>)}</select></div>
            <div><label className="label">{t('inventory.rfq.vendor')}</label><select className="input" required value={form.VendorId} onChange={e => setForm({ ...form, VendorId: e.target.value })}><option value="">{t('inventory.rfq.selectVendor')}</option>{vendors.map(v => <option key={v.VendorId} value={v.VendorId}>{v.VendorName}</option>)}</select></div>
            <div><label className="label">{t('inventory.rfq.date')}</label><input className="input" type="date" value={form.QuotationDate} onChange={e => setForm({ ...form, QuotationDate: e.target.value })} /></div>
            <div><label className="label">{t('inventory.rfq.remarks')}</label><input className="input" value={form.Remarks} onChange={e => setForm({ ...form, Remarks: e.target.value })} /></div>
          </div>

          <table className="table-base"><thead><tr><th>{t('inventory.rfq.itemCol')}</th><th>{t('inventory.rfq.qtyCol')}</th><th>{t('inventory.rfq.rateCol')}</th><th>{t('inventory.rfq.descriptionCol')}</th><th></th></tr></thead>
            <tbody>{items.map((item, idx) => (
              <tr key={idx}>
                <td><select className="input min-w-48" value={item.ItemId} onChange={e => setItems(prev => prev.map((r, i) => i === idx ? { ...r, ItemId: Number(e.target.value) } : r))}><option value="">{t('inventory.rfq.select')}</option>{catalog.map(i => <option key={i.ItemId} value={i.ItemId}>{i.ItemName}</option>)}</select></td>
                <td><input className="input w-20" type="number" min="1" value={item.QuotedQuantity} onChange={e => setItems(prev => prev.map((r, i) => i === idx ? { ...r, QuotedQuantity: Number(e.target.value) } : r))} /></td>
                <td><input className="input w-28" type="number" min="0" step="0.01" value={item.QuotedRate} onChange={e => setItems(prev => prev.map((r, i) => i === idx ? { ...r, QuotedRate: Number(e.target.value) } : r))} /></td>
                <td><input className="input w-48" value={item.Description} onChange={e => setItems(prev => prev.map((r, i) => i === idx ? { ...r, Description: e.target.value } : r))} /></td>
                <td>{items.length > 1 && <button className="btn-ghost p-1 text-red-500" onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}><Trash2 className="w-4 h-4" /></button>}</td>
              </tr>
            ))}</tbody>
          </table>
          <button className="btn-secondary text-sm" onClick={() => setItems(prev => [...prev, { ItemId: 0, QuotedQuantity: 1, QuotedRate: 0, Description: '' }])}><Plus className="w-4 h-4" /> {t('inventory.rfq.addItem')}</button>

          <div className="flex justify-end"><button className="btn-primary" onClick={submit} disabled={createQuote.isPending}><Send className="w-4 h-4" /> {createQuote.isPending ? t('inventory.rfq.submitting') : t('inventory.rfq.submitQuotation')}</button></div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>{t('inventory.rfq.quotationNo')}</th><th>{t('inventory.rfq.rfqCol')}</th><th>{t('inventory.rfq.vendorCol')}</th><th>{t('inventory.rfq.dateCol')}</th><th>{t('inventory.rfq.status')}</th></tr></thead>
            <tbody>{quotations.length === 0 ? <tr><td colSpan={5} className="text-center py-8 text-[var(--color-text-muted)]">{t('inventory.rfq.noQuotations')}</td></tr> : quotations.map(q => (
              <tr key={q.QuotationId}>
                <td className="font-medium">{q.QuotationNo}</td>
                <td>RFQ #{q.RFQId}</td>
                <td>Vendor #{q.VendorId}</td>
                <td>{q.QuotationDate || '—'}</td>
                <td><span className={`badge ${q.Status === 'accepted' ? 'badge-success' : 'badge-secondary'}`}>{q.Status}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
