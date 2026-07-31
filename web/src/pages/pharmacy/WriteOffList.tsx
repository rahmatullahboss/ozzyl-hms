import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatDisplayDate } from '../../lib/date-utils';

interface WriteOff { id: number; writeoff_no: string; writeoff_date: string; reason: string; total_amount: number; approved_by?: string; is_active: number; }

export default function WriteOffList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);

  const { data, isLoading: loading } = useApiQuery<{ writeOffs: WriteOff[] }>(
    queryKeys.pharmacy.writeOffs(),
    '/api/pharmacy/write-offs',
  );
  const records = data?.writeOffs ?? [];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><h1 className="page-title">{t('writeOffs', { defaultValue: 'Stock Write-Offs' })}</h1><p className="section-subtitle mt-1">{t('writeOffsSubtitle', { defaultValue: 'Expired/damaged stock disposal records' })}</p></div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>{t('writeOffNo', { defaultValue: 'Write-Off #' })}</th><th>{t('date', { ns: 'common', defaultValue: 'Date' })}</th><th>{t('writeOffReason', { defaultValue: 'Reason' })}</th><th className="text-right">{t('writeOffAmount', { defaultValue: 'Amount (৳)' })}</th><th>{t('approvedBy', { defaultValue: 'Approved By' })}</th><th>{t('status', { ns: 'common', defaultValue: 'Status' })}</th></tr></thead>
              <tbody>
                {loading ? ([...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>))
                : records.length === 0 ? (<tr><td colSpan={6} className="py-16 text-center text-[var(--color-text-muted)]">{t('noWriteOffs', { defaultValue: 'No write-offs' })}</td></tr>)
                : records.map(r => (
                  <tr key={r.id}>
                    <td className="font-mono text-sm font-medium">{r.writeoff_no}</td>
                    <td>{formatDisplayDate(r.writeoff_date)}</td>
                    <td>{r.reason}</td>
                    <td className="text-right font-data">৳{((r.total_amount ?? 0) / 100).toLocaleString()}</td>
                    <td>{r.approved_by || '—'}</td>
                    <td><span className={`badge ${r.is_active ? 'badge-info' : 'badge-danger'}`}>{r.is_active ? 'Active' : 'Void'}</span></td>
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
