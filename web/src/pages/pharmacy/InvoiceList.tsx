import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Link, useParams } from 'react-router';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatDisplayDate } from '../../lib/date-utils';

interface Invoice {
  id: number; invoice_no: string; created_at: string;
  patient_id?: number; total_amount: number; paid_amount: number;
  credit_amount: number; payment_mode: string; is_active: number;
  is_return: number;
}

export default function InvoiceList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filters = { from: dateFrom || undefined, to: dateTo || undefined };

  const { data, isLoading: loading } = useApiQuery<{ invoices: Invoice[] }>(
    queryKeys.pharmacy.invoices(filters),
    `/api/pharmacy/invoices?${new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v !== undefined) as [string, string][]
    ).toString()}`,
  );

  const invoices = data?.invoices ?? [];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div><h1 className="page-title">{t('invoices', { defaultValue: 'Sales Invoices' })}</h1></div>
          <Link to={`${base}/pharmacy/invoices/new`}><button className="btn-primary"><Plus className="w-4 h-4" /> {t('newInvoice', { defaultValue: 'New Invoice' })}</button></Link>
        </div>
        <div className="card p-4 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <label className="label text-sm whitespace-nowrap">{t('from', { defaultValue: 'From' })}</label>
            <input type="date" className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <label className="label text-sm whitespace-nowrap">{t('to', { defaultValue: 'To' })}</label>
            <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
        </div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr>
                <th>{t('invoiceNo', { defaultValue: 'Invoice #' })}</th>
                <th>{t('date', { defaultValue: 'Date' })}</th>
                <th className="text-right">{t('total', { defaultValue: 'Total ৳' })}</th>
                <th className="text-right">{t('paid', { defaultValue: 'Paid ৳' })}</th>
                <th className="text-right">{t('credit', { defaultValue: 'Credit ৳' })}</th>
                <th>{t('paymentMode', { defaultValue: 'Payment' })}</th>
                <th>{t('status', { ns: 'common', defaultValue: 'Status' })}</th>
              </tr></thead>
              <tbody>
                {loading ? ([...Array(6)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>))
                : invoices.length === 0 ? (<tr><td colSpan={7} className="py-16 text-center text-[var(--color-text-muted)]">{t('noInvoices', { defaultValue: 'No invoices' })}</td></tr>)
                : invoices.map(inv => (
                  <tr key={inv.id}>
                    <td className="font-medium font-mono text-sm">{inv.invoice_no}</td>
                    <td className="text-[var(--color-text-secondary)]">{inv.created_at ? formatDisplayDate(inv.created_at) : '—'}</td>
                    <td className="text-right font-data">৳{((inv.total_amount ?? 0) / 100).toLocaleString()}</td>
                    <td className="text-right font-data text-emerald-600">৳{((inv.paid_amount ?? 0) / 100).toLocaleString()}</td>
                    <td className="text-right font-data text-amber-600">৳{((inv.credit_amount ?? 0) / 100).toLocaleString()}</td>
                    <td><span className="badge badge-info capitalize">{inv.payment_mode || 'cash'}</span></td>
                    <td><span className={`badge ${inv.is_return ? 'badge-warning' : inv.is_active ? 'badge-success' : 'badge-danger'}`}>{inv.is_return ? 'Returned' : inv.is_active ? 'Active' : 'Void'}</span></td>
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
