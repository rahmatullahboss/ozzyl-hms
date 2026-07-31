import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatDisplayDate } from '../../lib/date-utils';

interface Settlement { id: number; settlement_no: string; settlement_date: string; patient_name?: string; total_amount: number; paid_amount: number; refund_amount: number; }

export default function SettlementList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);

  const { data, isLoading: loading } = useApiQuery<{ settlements: Settlement[] }>(
    queryKeys.pharmacy.settlements(),
    '/api/pharmacy/settlements',
  );
  const settlements = data?.settlements ?? [];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><h1 className="page-title">{t('settlements', { defaultValue: 'Credit Settlements' })}</h1></div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Settlement #</th><th>Date</th><th>Patient</th><th className="text-right">Total ৳</th><th className="text-right">Paid ৳</th><th className="text-right">Refund ৳</th></tr></thead>
              <tbody>
                {loading ? ([...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>))
                : settlements.length === 0 ? (<tr><td colSpan={6} className="py-16 text-center text-[var(--color-text-muted)]">No settlements</td></tr>)
                : settlements.map(s => (
                  <tr key={s.id}>
                    <td className="font-mono text-sm font-medium">{s.settlement_no}</td>
                    <td>{formatDisplayDate(s.settlement_date)}</td>
                    <td>{s.patient_name || '—'}</td>
                    <td className="text-right font-data">৳{((s.total_amount ?? 0) / 100).toLocaleString()}</td>
                    <td className="text-right font-data text-emerald-600">৳{((s.paid_amount ?? 0) / 100).toLocaleString()}</td>
                    <td className="text-right font-data text-blue-600">৳{((s.refund_amount ?? 0) / 100).toLocaleString()}</td>
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
