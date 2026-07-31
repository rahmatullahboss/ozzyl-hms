import { useState } from 'react';
import { ChevronRight, X, Printer } from 'lucide-react';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useTranslation } from 'react-i18next';
import { useFmt } from '../../hooks/useFmt';
import PayslipPrintFrame from './PayslipPrintFrame';

interface PayrollRun {
  id: number; run_month: string; status: 'draft' | 'locked' | 'approved' | 'cancelled';
  total_employees: number; total_gross: number; total_deductions: number; total_net: number;
}
interface Payslip {
  id: number; staff_id: number; staff_name: string; position: string; bank_account: string | null;
  total_earning: number; total_deduction: number; net_pay: number; overtime_hours: number; overtime_amount: number;
  leave_deduction: number; payable_days: number; breakdown_json: string | null; attendance_summary_json: string | null;
}
interface RunsListResponse { data: PayrollRun[]; pagination?: { page: number; limit: number; total: number }; }
interface RunDetailResponse { data: PayrollRun & { payslips: Payslip[] }; }

const statusBadgeClass: Record<string, string> = {
  draft: 'badge-warning',
  locked: 'badge-info',
  approved: 'badge-success',
  cancelled: 'badge-danger',
};

export default function RunsHistoryTab() {
  const { t } = useTranslation(['hr']);
  const { fmtCurrency, fmtMonth } = useFmt();

  const runsQuery = useApiQuery<RunsListResponse>(
    ['hr', 'payroll', 'runs', 'history'],
    '/api/hr/payroll/runs?page=1&limit=100',
  );
  const runs = runsQuery.data?.data ?? [];

  const [openRunId, setOpenRunId] = useState<number | null>(null);
  const [printStaffId, setPrintStaffId] = useState<number | null>(null);

  const detailQuery = useApiQuery<RunDetailResponse>(
    ['hr', 'payroll', 'run-detail', openRunId ?? 0],
    openRunId ? `/api/hr/payroll/runs/${openRunId}` : '',
    { enabled: !!openRunId },
  );
  const detail = detailQuery.data?.data;
  const payslips: Payslip[] = detail?.payslips ?? [];

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="p-5 border-b border-[var(--color-border)]">
          <h3 className="section-title">{t('hr:payroll.history.title')}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t('hr:payroll.history.month')}</th>
                <th className="text-center">{t('hr:payroll.history.employees')}</th>
                <th className="text-right">{t('hr:payroll.history.gross')}</th>
                <th className="text-right">{t('hr:payroll.history.net')}</th>
                <th>{t('hr:payroll.history.status')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runsQuery.isLoading && (
                <tr><td colSpan={6} className="text-center py-4">…</td></tr>
              )}
              {!runsQuery.isLoading && runs.length === 0 && (
                <tr><td colSpan={6} className="text-center py-6 text-[var(--color-text-muted)]">{t('hr:payroll.history.noRuns')}</td></tr>
              )}
              {runs.map((run) => (
                <tr key={run.id} className="hover:bg-[var(--color-bg-hover)]">
                  <td className="font-data font-medium">{fmtMonth(run.run_month)}</td>
                  <td className="text-center font-data">{run.total_employees}</td>
                  <td className="text-right font-data">{fmtCurrency(run.total_gross)}</td>
                  <td className="text-right font-data font-bold text-emerald-600">{fmtCurrency(run.total_net)}</td>
                  <td><span className={`badge ${statusBadgeClass[run.status] ?? 'badge-neutral'}`}>{t(`hr:payroll.status.${run.status}`, run.status)}</span></td>
                  <td>
                    <button onClick={() => setOpenRunId(run.id)} className="btn-ghost text-xs gap-1">
                      {t('hr:payroll.history.viewPayslips')}
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {openRunId && detail && (
        <div className="fixed inset-0 z-40 bg-black/40 flex" onClick={() => setOpenRunId(null)}>
          <div className="ml-auto h-full w-full max-w-3xl bg-[var(--color-bg)] shadow-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-[var(--color-bg)] border-b border-[var(--color-border)] p-4 flex items-center justify-between z-10">
              <div>
                <h3 className="section-title">{fmtMonth(detail.run_month)}</h3>
                <p className="text-sm text-[var(--color-text-muted)]">{detail.total_employees} {t('hr:payroll.employees')}</p>
              </div>
              <button onClick={() => setOpenRunId(null)} className="btn-ghost p-2"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{t('hr:table.staff')}</th>
                    <th className="text-right">{t('hr:payroll.totalEarning')}</th>
                    <th className="text-right">{t('hr:payroll.totalDeduction')}</th>
                    <th className="text-right">{t('hr:payroll.netPay')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payslips.map((p) => (
                    <tr key={p.id} className="hover:bg-[var(--color-bg-hover)]">
                      <td>
                        <div className="font-medium">{p.staff_name}</div>
                        <div className="text-xs text-[var(--color-text-muted)]">{p.position}</div>
                      </td>
                      <td className="text-right font-data">{fmtCurrency(p.total_earning)}</td>
                      <td className="text-right font-data text-red-600">{fmtCurrency(p.total_deduction)}</td>
                      <td className="text-right font-data font-bold">{fmtCurrency(p.net_pay)}</td>
                      <td>
                        <button
                          onClick={() => setPrintStaffId(p.staff_id)}
                          className="btn-ghost p-2"
                          title={t('hr:payroll.print.open') as string}
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {printStaffId && openRunId && detail && (
        <PayslipPrintFrame
          runId={openRunId}
          staffId={printStaffId}
          payslip={payslips.find((p) => p.staff_id === printStaffId) ?? null}
          onClose={() => setPrintStaffId(null)}
        />
      )}
    </div>
  );
}
