import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatDisplayDate } from '../../lib/date-utils';

interface Dispatch { id: number; dispatch_no: string; dispatch_date: string; source_store?: string; target_store?: string; received_by?: string; is_active: number; }

export default function DispatchList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);

  const { data, isLoading: loading } = useApiQuery<{ dispatches: Dispatch[] }>(
    queryKeys.pharmacy.dispatches(),
    '/api/pharmacy/dispatches',
  );

  const records = data?.dispatches ?? [];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><h1 className="page-title">{t('dispatches', { defaultValue: 'Stock Dispatches' })}</h1><p className="section-subtitle mt-1">{t('dispatchesSubtitle', { defaultValue: 'Inter-store dispatch records' })}</p></div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>{t('dispatchNo', { defaultValue: 'Dispatch #' })}</th><th>{t('date', { ns: 'common', defaultValue: 'Date' })}</th><th>{t('dispatchFrom', { defaultValue: 'From' })}</th><th>{t('dispatchTo', { defaultValue: 'To' })}</th><th>{t('receivedBy', { defaultValue: 'Received By' })}</th><th>{t('status', { ns: 'common', defaultValue: 'Status' })}</th></tr></thead>
              <tbody>
                {loading ? ([...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>))
                : records.length === 0 ? (<tr><td colSpan={6} className="py-16 text-center text-[var(--color-text-muted)]">{t('noDispatches', { defaultValue: 'No dispatches' })}</td></tr>)
                : records.map(r => (
                  <tr key={r.id}>
                    <td className="font-mono text-sm font-medium">{r.dispatch_no}</td>
                    <td>{formatDisplayDate(r.dispatch_date)}</td>
                    <td>{r.source_store || '—'}</td>
                    <td>{r.target_store || '—'}</td>
                    <td>{r.received_by || '—'}</td>
                    <td><span className={`badge ${r.is_active ? 'badge-success' : 'badge-danger'}`}>{r.is_active ? 'Active' : 'Void'}</span></td>
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
