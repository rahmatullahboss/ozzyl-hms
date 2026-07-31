import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatDisplayDate } from '../../lib/date-utils';

interface Narcotic { id: number; record_no: string; record_date: string; item_name?: string; batch_no?: string; quantity: number; issued_to?: string; purpose?: string; authorized_by?: string; is_active: number; }

export default function NarcoticRegister({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);

  const { data, isLoading: loading } = useApiQuery<{ narcotics: Narcotic[] }>(
    queryKeys.pharmacy.narcotics(),
    '/api/pharmacy/narcotics',
  );
  const records = data?.narcotics ?? [];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><h1 className="page-title">{t('narcoticRegister', { defaultValue: 'Narcotic Register' })}</h1><p className="section-subtitle mt-1">Controlled substance logs</p></div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Record #</th><th>Date</th><th>Item</th><th>Batch</th><th className="text-right">Qty</th><th>Issued To</th><th>Purpose</th><th>Authorized By</th></tr></thead>
              <tbody>
                {loading ? ([...Array(4)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>))
                : records.length === 0 ? (<tr><td colSpan={8} className="py-16 text-center text-[var(--color-text-muted)]">No narcotic records</td></tr>)
                : records.map(r => (
                  <tr key={r.id}>
                    <td className="font-mono text-sm font-medium">{r.record_no}</td>
                    <td>{formatDisplayDate(r.record_date)}</td>
                    <td>{r.item_name || '—'}</td>
                    <td className="font-mono text-xs">{r.batch_no || '—'}</td>
                    <td className="text-right font-data">{r.quantity}</td>
                    <td>{r.issued_to || '—'}</td>
                    <td className="text-[var(--color-text-secondary)]">{r.purpose || '—'}</td>
                    <td>{r.authorized_by || '—'}</td>
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
