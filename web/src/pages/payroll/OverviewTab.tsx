import { useMemo, useState } from 'react';
import { DollarSign, Calendar, Users, Download, Check, RefreshCw, Calculator, Lock, Printer } from 'lucide-react';
import toast from 'react-hot-toast';
import KPICard from '../../components/dashboard/KPICard';
import EmptyState from '../../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import { useFmt } from '../../hooks/useFmt';

interface PayrollRun {
  id: number; run_month: string;
  status: 'draft' | 'locked' | 'approved' | 'cancelled';
  total_employees: number; total_gross: number; total_deductions: number; total_net: number;
}
interface Payslip {
  id: number; staff_id: number; staff_name?: string; month: string;
  total_earning: number; total_deduction: number; net_pay: number;
  overtime_hours?: number; overtime_amount?: number;
  leave_deduction?: number; payable_days?: number;
  breakdown_json?: string | null; attendance_summary_json?: string | null;
}
interface AttendanceSummary {
  staff_id: number; staff_name: string; position: string;
  present_days: number; late_days: number; absent_days: number; leave_days: number; half_days: number;
}
interface RunsResponse { runs?: PayrollRun[]; data?: PayrollRun[]; }
interface RunDetailResponse { run: PayrollRun; payslips: Payslip[]; data?: PayrollRun & { payslips: Payslip[] }; }
interface AttendanceSummaryResponse { summary: AttendanceSummary[]; }
interface MessageResponse { message?: string; run?: PayrollRun; }

interface ReviewRow {
  staff_id: number; staff_name: string;
  basic_salary: number; present_days: number; late_days: number; late_deduction: number;
  overtime_hours: number; overtime_amount: number; net_payable: number; original_net: number;
  payslip_id: number; persisted: boolean;
}

const statusBadgeClass: Record<string, string> = {
  draft: 'badge-warning', locked: 'badge-info', approved: 'badge-success', cancelled: 'badge-danger',
};

export default function OverviewTab() {
  const { t } = useTranslation(['hr', 'common']);
  const { fmtCurrency, fmtMonth } = useFmt();
  const queryClient = useQueryClient();

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [persistedOverrides, setPersistedOverrides] = useState<Record<number, number>>({});

  const runsQuery = useApiQuery<RunsResponse>(queryKeys.hr.payrollRuns(), '/api/hr/payroll/runs?limit=50');
  const allRuns = useMemo(() => runsQuery.data?.runs ?? runsQuery.data?.data ?? [], [runsQuery.data]);

  const currentRun = useMemo(() => {
    if (activeRunId) return allRuns.find((r) => r.id === activeRunId) ?? null;
    return allRuns.find((r) => r.run_month === selectedMonth) ?? null;
  }, [allRuns, selectedMonth, activeRunId]);

  const runDetailQuery = useApiQuery<RunDetailResponse>(
    ['hr', 'payroll', 'run-detail', currentRun?.id ?? 0],
    `/api/hr/payroll/runs/${currentRun?.id}`,
    { enabled: !!currentRun?.id },
  );
  const payslips: Payslip[] = runDetailQuery.data?.payslips ?? runDetailQuery.data?.data?.payslips ?? [];

  const attendanceQuery = useApiQuery<AttendanceSummaryResponse>(
    queryKeys.hr.attendanceSummary(selectedMonth),
    `/api/hr/attendance/summary?month=${selectedMonth}`,
  );
  const attendanceMap = useMemo(() => {
    const map = new Map<number, AttendanceSummary>();
    for (const row of attendanceQuery.data?.summary ?? []) map.set(row.staff_id, row);
    return map;
  }, [attendanceQuery.data]);

  const reviewRows: ReviewRow[] = useMemo(() => {
    if (payslips.length === 0) return [];
    return payslips.map((ps) => {
      const att = attendanceMap.get(ps.staff_id);
      const lateDays = att?.late_days ?? 0;
      const lateDeduction = lateDays * ((ps.total_earning / 30) * 0.5);
      const net = persistedOverrides[ps.staff_id] ?? ps.net_pay;
      return {
        payslip_id: ps.id,
        staff_id: ps.staff_id,
        staff_name: ps.staff_name ?? `Staff #${ps.staff_id}`,
        basic_salary: ps.total_earning,
        present_days: att?.present_days ?? ps.payable_days ?? 0,
        late_days: lateDays,
        late_deduction: lateDeduction,
        overtime_hours: ps.overtime_hours ?? 0,
        overtime_amount: ps.overtime_amount ?? 0,
        net_payable: net,
        original_net: ps.net_pay,
        persisted: persistedOverrides[ps.staff_id] !== undefined,
      };
    });
  }, [payslips, attendanceMap, persistedOverrides]);

  const totals = useMemo(() => reviewRows.reduce(
    (acc, r) => ({
      basic_salary: acc.basic_salary + r.basic_salary,
      present_days: acc.present_days + r.present_days,
      late_days: acc.late_days + r.late_days,
      late_deduction: acc.late_deduction + r.late_deduction,
      overtime_amount: acc.overtime_amount + r.overtime_amount,
      net_payable: acc.net_payable + r.net_payable,
    }),
    { basic_salary: 0, present_days: 0, late_days: 0, late_deduction: 0, overtime_amount: 0, net_payable: 0 },
  ), [reviewRows]);

  const generateMutation = useApiMutation<MessageResponse, { runMonth: string }>(
    'post', '/api/hr/payroll/runs',
    {
      onSuccess: (data) => {
        if (data?.message?.toLowerCase().includes('already exists')) {
          toast.success(t('hr:toasts.payrollGenerated', 'Payroll generated') as string);
        } else {
          toast.success(data?.message || (t('hr:toasts.payrollGenerated', 'Payroll generated') as string));
        }
        queryClient.invalidateQueries({ queryKey: queryKeys.hr.payrollRuns() });
        if (data?.run?.id) setActiveRunId(data.run.id);
      },
      onError: (err) => { toast.error(err.message || (t('hr:toasts.failed', 'Failed') as string)); },
    },
  );

  const lockMutation = useApiMutation<unknown, { id: number }>(
    'post', (vars) => `/api/hr/payroll/runs/${vars.id}/lock`,
    {
      onSuccess: () => {
        toast.success(t('hr:toasts.payrollLocked', 'Payroll locked') as string);
        queryClient.invalidateQueries({ queryKey: queryKeys.hr.payrollRuns() });
      },
      onError: (err) => { toast.error(err.message || (t('hr:toasts.failed', 'Failed') as string)); },
    },
  );

  const approveMutation = useApiMutation<unknown, { id: number }>(
    'post', (vars) => `/api/hr/payroll/runs/${vars.id}/approve`,
    {
      onSuccess: () => {
        toast.success(t('hr:toasts.payrollApproved', 'Payroll approved') as string);
        queryClient.invalidateQueries({ queryKey: queryKeys.hr.payrollRuns() });
      },
      onError: (err) => { toast.error(err.message || (t('hr:toasts.failed', 'Failed') as string)); },
    },
  );

  const patchMutation = useApiMutation<unknown, { payslipId: number; staffId: number; netPay: number; reason: string }>(
    'patch', (vars) => `/api/hr/payroll/payslips/${vars.payslipId}`,
    {
      onSuccess: (_data, vars) => {
        setPersistedOverrides((prev) => ({ ...prev, [vars.staffId]: vars.netPay }));
        toast.success(t('hr:payroll.adjustments.saved', 'Net pay override saved') as string);
        queryClient.invalidateQueries({ queryKey: queryKeys.hr.payrollRuns() });
        queryClient.invalidateQueries({ queryKey: ['hr', 'payroll', 'run-detail', currentRun?.id ?? 0] });
        queryClient.invalidateQueries({ queryKey: queryKeys.hr.payslipAdjustments(currentRun?.id ?? 0) });
      },
      onError: (err) => { toast.error(err.message || (t('hr:toasts.failed', 'Failed') as string)); },
    },
  );

  const overtimeMutation = useApiMutation<unknown, { payrollRunId: number; staffId: number; includeOvertime: true }>(
    'post', '/api/hr/payroll/overtime-integrate',
    { onSuccess: () => {}, onError: () => {} },
  );

  const isReadOnly = currentRun?.status === 'approved' || currentRun?.status === 'locked';
  const isDraft = currentRun?.status === 'draft';

  const handleGenerate = () => generateMutation.mutate({ runMonth: selectedMonth });
  const handleConfirmAndPrint = async () => {
    if (!currentRun) return;
    if (currentRun.status === 'draft') await lockMutation.mutateAsync({ id: currentRun.id });
    if (currentRun.status === 'locked' || currentRun.status === 'draft') {
      await approveMutation.mutateAsync({ id: currentRun.id });
    }
    window.print();
  };

  const handleRunOvertime = async () => {
    if (!currentRun) return;
    toast.loading(t('hr:payroll.overtime.running', 'Integrating overtime...') as string, { id: 'ot' });
    let ok = 0; let failed = 0;
    for (const p of payslips) {
      try {
        await overtimeMutation.mutateAsync({ payrollRunId: currentRun.id, staffId: p.staff_id, includeOvertime: true });
        ok++;
      } catch { failed++; }
    }
    toast.dismiss('ot');
    if (failed === 0) {
      toast.success(t('hr:payroll.overtime.done', { ok, total: payslips.length } as any) as string);
    } else {
      toast.error(t('hr:payroll.overtime.partial', { ok, total: payslips.length, failed } as any) as string);
    }
    queryClient.invalidateQueries({ queryKey: ['hr', 'payroll', 'run-detail', currentRun.id] });
    queryClient.invalidateQueries({ queryKey: queryKeys.hr.payrollRuns() });
  };

  const handleExportCSV = () => {
    if (reviewRows.length === 0) return;
    const headers = ['Staff Name', 'Basic Salary', 'Present Days', 'Late Days', 'Late Deduction', 'Overtime Amount', 'Net Payable'];
    const csvRows = [
      headers.join(','),
      ...reviewRows.map((r) => [r.staff_name, r.basic_salary, r.present_days, r.late_days, r.late_deduction.toFixed(2), r.overtime_amount.toFixed(2), r.net_payable.toFixed(2)].join(',')),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `payroll-${selectedMonth}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(t('hr:toasts.csvExported', 'CSV exported') as string);
  };

  const handleNetChange = (staffId: number, value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return;
    setPersistedOverrides((prev) => ({ ...prev, [staffId]: num }));
  };

  const handleNetCommit = (row: ReviewRow) => {
    if (row.net_payable === row.original_net) return;
    const reason = window.prompt(t('hr:payroll.adjustments.reason', 'Reason') as string, '');
    if (!reason || reason.length < 3) { toast.error(t('hr:toasts.failed', 'Failed') as string); return; }
    patchMutation.mutate({ payslipId: row.payslip_id, staffId: row.staff_id, netPay: row.net_payable, reason });
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="sticky top-0 z-20 bg-[var(--color-bg)] border-b border-[var(--color-border)] -mx-4 lg:-mx-6 px-4 lg:px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Calculator className="w-6 h-6 text-[var(--color-primary)]" />
            {t('hr:payroll.title', 'Payroll')}
          </h1>
          <p className="section-subtitle mt-1">{t('hr:subtitle', 'Staff attendance, payroll & overview')}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input type="month" value={selectedMonth}
              onChange={(e) => { setSelectedMonth(e.target.value); setActiveRunId(null); setPersistedOverrides({}); }}
              className="input pl-9 w-44" />
          </div>
          <button onClick={handleGenerate} disabled={generateMutation.isPending} className="btn-primary gap-2 text-sm font-semibold">
            {generateMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
            {generateMutation.isPending ? (t('common:saving', 'Saving...') as string) : (t('hr:payroll.create', 'Create Payroll') as string)}
          </button>
        </div>
      </div>

      {currentRun && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title={t('hr:payroll.totalEmployees', 'Total Employees')} value={currentRun.total_employees} loading={runsQuery.isLoading} icon={<Users className="w-5 h-5" />} iconBg="bg-blue-50 text-blue-600" index={0} />
          <KPICard title={t('hr:payroll.totalGross', 'Total Gross')} value={fmtCurrency(currentRun.total_gross)} loading={runsQuery.isLoading} icon={<DollarSign className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={1} />
          <KPICard title={t('hr:payroll.totalDeductions', 'Total Deductions')} value={fmtCurrency(currentRun.total_deductions)} loading={runsQuery.isLoading} icon={<Lock className="w-5 h-5" />} iconBg="bg-red-50 text-red-600" index={2} />
          <KPICard title={t('hr:payroll.totalNet', 'Total Net')} value={fmtCurrency(currentRun.total_net)} loading={runsQuery.isLoading} icon={<Check className="w-5 h-5" />} iconBg="bg-purple-50 text-purple-600" index={3} />
        </div>
      )}

      {currentRun && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-[var(--color-text-muted)]">{t('hr:payroll.runStatus', 'Status')}:</span>
          <span className={`badge ${statusBadgeClass[currentRun.status] ?? 'badge-neutral'}`}>
            {t(`hr:payroll.status.${currentRun.status}`, currentRun.status.toUpperCase())}
          </span>
          <span className="text-sm text-[var(--color-text-muted)]">{fmtMonth(currentRun.run_month)}</span>
          {isDraft && payslips.length > 0 && (
            <button onClick={handleRunOvertime} disabled={overtimeMutation.isPending} className="btn-secondary text-xs gap-1.5 ml-auto">
              <RefreshCw className="w-3.5 h-3.5" />{t('hr:payroll.overtime.run', 'Run Overtime Integration') as string}
            </button>
          )}
        </div>
      )}

      {runsQuery.isLoading ? (
        <div className="card p-6 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-[var(--color-border-light)] rounded animate-pulse" />)}
        </div>
      ) : reviewRows.length === 0 ? (
        <EmptyState
          icon={<Calculator className="w-8 h-8 text-[var(--color-text-muted)]" />}
          title={t('hr:payroll.noPayrollRun', 'No payroll run for this month')}
          description={t('hr:payroll.generateFirst', 'Click "Create Payroll" to create a payroll run for the selected month.')}
          action={<button onClick={handleGenerate} disabled={generateMutation.isPending} className="btn-primary gap-2"><Calculator className="w-4 h-4" />{t('hr:payroll.create', 'Create Payroll') as string}</button>}
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-10">#</th>
                  <th>{t('hr:payroll.staffName', 'Staff Name')}</th>
                  <th className="text-right">{t('hr:payroll.basicSalary', 'Basic Salary')}</th>
                  <th className="text-center">{t('hr:payroll.presentDays', 'Present Days')}</th>
                  <th className="text-center">{t('hr:payroll.lateDays', 'Late Days')}</th>
                  <th className="text-right">{t('hr:payroll.lateDeduction', 'Late Deduction')}</th>
                  <th className="text-right">{t('hr:payroll.overtime', 'Overtime')}</th>
                  <th className="text-right">{t('hr:payroll.netPayable', 'Net Payable')}</th>
                </tr>
              </thead>
              <tbody>
                {reviewRows.map((row, idx) => (
                  <tr key={row.staff_id} className="hover:bg-[var(--color-bg-hover)]">
                    <td className="text-[var(--color-text-muted)] text-sm">{idx + 1}</td>
                    <td className="font-medium">{row.staff_name}</td>
                    <td className="text-right font-data">{fmtCurrency(row.basic_salary)}</td>
                    <td className="text-center font-data">{row.present_days}</td>
                    <td className="text-center font-data">{row.late_days}</td>
                    <td className="text-right font-data text-red-500 font-semibold">{row.late_deduction > 0 ? `- ${fmtCurrency(row.late_deduction)}` : '—'}</td>
                    <td className="text-right font-data text-emerald-600 font-semibold">{row.overtime_amount > 0 ? `+ ${fmtCurrency(row.overtime_amount)}` : '—'}</td>
                    <td className="text-right">
                      {isReadOnly ? (
                        <span className="font-data font-bold">{fmtCurrency(row.net_payable)}</span>
                      ) : (
                        <div className="flex items-center gap-1 justify-end">
                          <input
                            type="number" value={row.net_payable}
                            onChange={(e) => handleNetChange(row.staff_id, e.target.value)}
                            onBlur={() => handleNetCommit(row)}
                            className="input w-28 text-right font-data text-sm py-1" step="0.01"
                          />
                          {row.persisted && <span className="text-xs text-emerald-600">✓</span>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--color-border)] font-bold bg-[var(--color-bg-secondary)]">
                  <td></td><td>{t('common:total', 'Total')}</td>
                  <td className="text-right font-data">{fmtCurrency(totals.basic_salary)}</td>
                  <td className="text-center font-data">{totals.present_days}</td>
                  <td className="text-center font-data">{totals.late_days}</td>
                  <td className="text-right font-data text-red-500">{totals.late_deduction > 0 ? `- ${fmtCurrency(totals.late_deduction)}` : '—'}</td>
                  <td className="text-right font-data text-emerald-600">{totals.overtime_amount > 0 ? `+ ${fmtCurrency(totals.overtime_amount)}` : '—'}</td>
                  <td className="text-right font-data">{fmtCurrency(totals.net_payable)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {reviewRows.length > 0 && (
        <div className="h-24" />
      )}

      {reviewRows.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-white dark:bg-slate-900 border-t border-[var(--color-border)] shadow-lg print:hidden">
          <div className="max-w-7xl mx-auto px-4 lg:px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-6 text-sm">
              <div><span className="text-[var(--color-text-muted)]">{t('hr:payroll.employees', 'Employees')}: </span><span className="font-bold">{reviewRows.length}</span></div>
              <div><span className="text-[var(--color-text-muted)]">{t('hr:payroll.gross', 'Gross')}: </span><span className="font-bold">{fmtCurrency(totals.basic_salary)}</span></div>
              <div><span className="text-[var(--color-text-muted)]">{t('hr:payroll.deductions', 'Deductions')}: </span><span className="font-bold text-red-600">{fmtCurrency(totals.late_deduction)}</span></div>
              <div><span className="text-[var(--color-text-muted)]">{t('hr:payroll.netTotal', 'Net Total')}: </span><span className="font-bold text-emerald-600">{fmtCurrency(totals.net_payable)}</span></div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleExportCSV} className="btn-secondary gap-1.5 text-sm"><Download className="w-4 h-4" />{t('hr:payroll.exportCSV', 'Export CSV') as string}</button>
              {!isReadOnly && (
                <button onClick={handleConfirmAndPrint} disabled={lockMutation.isPending || approveMutation.isPending} className="btn-primary gap-1.5 text-sm">
                  {(lockMutation.isPending || approveMutation.isPending) ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                  {t('hr:payroll.confirmAndPrint', 'Confirm & Print Payslips') as string}
                </button>
              )}
              {currentRun?.status === 'locked' && (
                <button onClick={() => currentRun && approveMutation.mutate({ id: currentRun.id })} disabled={approveMutation.isPending} className="btn-primary gap-1.5 text-sm">
                  {approveMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {t('hr:payroll.approveRun', 'Approve') as string}
                </button>
              )}
              {currentRun?.status === 'approved' && (
                <span className="badge badge-success gap-1 text-sm"><Check className="w-3.5 h-3.5" />{t('hr:payroll.status.approved', 'Approved') as string}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
