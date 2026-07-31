/**
 * MDDashboard — Managing Director dashboard.
 *
 * Mirrors web/src/pages/MDDashboard.tsx (single source of truth lives in
 * the web app; this lifestyle fork is kept in sync to avoid silent drift).
 * The lifestyle app uses a different build with its own apiClient + format
 * helpers, so we can't import from web/src directly.
 */
import { AlertTriangle, DollarSign, RefreshCw, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import { useApiQuery } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { formatCurrency } from '../lib/format';
import type { TenantRole } from '@shared/authz';

interface DailyData {
  date: string;
  total: number;
  bySource?:   { source?: string;   total: number }[];
  byCategory?: { category?: string; total: number }[];
}

/** Unified breakdown row used in either income or expense list. */
type BreakdownRow = { source?: string; category?: string; total: number };

interface MonthlyData {
  month:    string;
  income:   number;
  expenses: number;
  profit:   number;
  margin:   string;
}

interface Staff {
  id:       number;
  name:     string;
  position: string;
  salary:   number;
  status:   string;
}

interface StaffResponse { staff?: Staff[] }

const EMPTY_DAILY:   DailyData  = { date: '', total: 0 };
const EMPTY_MONTHLY: MonthlyData = { month: '', income: 0, expenses: 0, profit: 0, margin: '0' };
const STAFF_VISIBLE = 5;

const fmtBDT = (n: number) => formatCurrency(n, { fractionDigits: 0 });

export default function MDDashboard({ role = 'md' }: { role?: TenantRole }) {
  const { t } = useTranslation(['dashboard', 'common']);
  const queryClient = useQueryClient();

  const incomeQ  = useApiQuery<DailyData>(queryKeys.md.dailyIncome(),   '/api/dashboard/daily-income');
  const expenseQ = useApiQuery<DailyData>(queryKeys.md.dailyExpenses(), '/api/dashboard/daily-expenses');
  const monthlyQ = useApiQuery<MonthlyData>(queryKeys.md.monthlySummary(), '/api/dashboard/monthly-summary');
  const staffQ   = useApiQuery<StaffResponse>(queryKeys.staff.list(),   '/api/staff');

  const dailyIncome   = incomeQ.data   ?? EMPTY_DAILY;
  const dailyExpenses = expenseQ.data  ?? EMPTY_DAILY;
  const monthly       = monthlyQ.data  ?? EMPTY_MONTHLY;
  const staff         = staffQ.data?.staff ?? [];

  const hasError = incomeQ.isError || expenseQ.isError || monthlyQ.isError || staffQ.isError;

  const retryAll = () => {
    incomeQ.refetch();
    expenseQ.refetch();
    monthlyQ.refetch();
    staffQ.refetch();
  };

  const todayProfit = dailyIncome.total - dailyExpenses.total;
  const expenseBreakdown: BreakdownRow[] = dailyExpenses.byCategory ?? dailyExpenses.bySource ?? [];
  const staffVisible = staff.slice(0, STAFF_VISIBLE);

  if (hasError) toast.error(t('clinical.failed_to_fetch_data', { defaultValue: 'Failed to load dashboard data' }));

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Today KPIs ── */}
        <div>
          <h1 className="page-title mb-4">{t('managingDirectorDashboard', { defaultValue: 'Managing Director Dashboard' })}</h1>

          {hasError && (
            <div
              role="alert"
              className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            >
              <span className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {t('failedToLoadDashboard', { defaultValue: 'Failed to load dashboard data. Some numbers may be outdated.' })}
              </span>
              <button
                type="button"
                onClick={retryAll}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {t('retry', { ns: 'dashboard', defaultValue: 'Retry' })}
              </button>
            </div>
          )}

          <div aria-live="polite" aria-busy={incomeQ.isLoading || expenseQ.isLoading || monthlyQ.isLoading || staffQ.isLoading} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard title={t('todaysIncome',   { defaultValue: "Today's Income" })}     value={fmtBDT(dailyIncome.total)}  loading={incomeQ.isLoading}   icon={<TrendingUp className="w-5 h-5" />}   iconBg="bg-emerald-50 text-emerald-600" index={0} />
            <KPICard title={t('todaysExpenses', { defaultValue: "Today's Expenses" })}   value={fmtBDT(dailyExpenses.total)} loading={expenseQ.isLoading} icon={<TrendingDown className="w-5 h-5" />} iconBg="bg-red-50 text-red-600"          index={1} />
            <KPICard title={t('todaysProfit',   { defaultValue: "Today's Profit" })}      value={fmtBDT(todayProfit)}         loading={monthlyQ.isLoading} icon={<DollarSign className="w-5 h-5" />}  iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={2} />
            <KPICard title={t('totalStaff',     { ns: 'staff', defaultValue: 'Total Staff' })} value={staff.length}          loading={staffQ.isLoading}    icon={<Users className="w-5 h-5" />}      iconBg="bg-blue-50 text-blue-600"           index={3} />
          </div>
        </div>

        {/* ── Monthly Summary (always rendered — skeleton during isLoading) ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: t('monthlyIncome',   { ns: 'common', defaultValue: 'Monthly Income' }),   value: fmtBDT(monthly.income),   color: 'text-emerald-600' },
            { label: t('monthlyExpenses', { ns: 'common', defaultValue: 'Monthly Expenses' }), value: fmtBDT(monthly.expenses), color: 'text-red-600' },
            { label: t('monthlyProfit',   { ns: 'common', defaultValue: 'Monthly Profit' }),   value: `${fmtBDT(monthly.profit)} (${monthly.margin}%)`, color: monthly.profit >= 0 ? 'text-[var(--color-primary)]' : 'text-red-600' },
          ].map(({ label, value, color }) => (
            <div key={label} className="card p-5">
              <p className="text-xs text-[var(--color-text-muted)] mb-1">{label}</p>
              {monthlyQ.isLoading ? (
                <div className="skeleton h-7 w-28 rounded" />
              ) : (
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
              )}
            </div>
          ))}
        </div>

        {/* ── Income + Expense Sources ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="card p-5">
            <h3 className="section-title mb-4">{t('incomeSourcesToday', { defaultValue: 'Income Sources Today' })}</h3>
            {dailyIncome.bySource?.length ? (
              <div className="space-y-2">
                {dailyIncome.bySource.map((item, i) => (
                  <div key={`${item.source ?? 'unknown'}-${i}`} className="flex justify-between text-sm">
                    <span className="capitalize text-[var(--color-text-secondary)]">{item.source}</span>
                    <span className="font-medium text-emerald-600">{fmtBDT(item.total || 0)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">{t('noData', { ns: 'common', defaultValue: 'No data' })}</p>
            )}
          </div>

          <div className="card p-5">
            <h3 className="section-title mb-4">{t('expensesToday', { defaultValue: 'Expenses Today' })}</h3>
            {expenseBreakdown.length ? (
              <div className="space-y-2">
                {expenseBreakdown.map((item, i) => (
                  <div key={`${item.category ?? item.source ?? 'unknown'}-${i}`} className="flex justify-between text-sm">
                    <span className="capitalize text-[var(--color-text-secondary)]">{item.category ?? item.source ?? 'other'}</span>
                    <span className="font-medium text-red-600">{fmtBDT(item.total || 0)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">{t('noData', { ns: 'common', defaultValue: 'No data' })}</p>
            )}
          </div>
        </div>

        {/* ── Staff Overview ── */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--color-border)]">
            <h3 className="section-title">{t('staffOverview', { defaultValue: 'Staff Overview' })}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>{t('name', { ns: 'common' })}</th><th>{t('position', { defaultValue: 'Position' })}</th><th>{t('salary', { defaultValue: 'Salary' })}</th><th>{t('status', { ns: 'common' })}</th></tr></thead>
              <tbody>
                {staffQ.isLoading ? (
                  [...Array(STAFF_VISIBLE)].map((_, i) => <tr key={i}>{[...Array(4)].map((_, j) => <td key={j}><div className="skeleton h-4 rounded" /></td>)}</tr>)
                ) : staff.length === 0 ? (
                  <tr><td colSpan={4} className="py-12 text-center text-[var(--color-text-muted)]">{t('noStaff', { ns: 'staff', defaultValue: 'No staff found' })}</td></tr>
                ) : (
                  staffVisible.map(m => (
                    <tr key={m.id}>
                      <td className="font-medium">{m.name}</td>
                      <td className="text-sm text-[var(--color-text-secondary)]">{m.position}</td>
                      <td className="font-data text-sm">{fmtBDT(m.salary)}</td>
                      <td><span className={`badge ${m.status === 'active' ? 'badge-success' : 'badge-secondary'}`}>{m.status}</span></td>
                    </tr>
                  ))
                )}
              </tbody>
              {staff.length > STAFF_VISIBLE && !staffQ.isLoading && (
                <tfoot>
                  <tr>
                    <td colSpan={4} className="text-xs text-[var(--color-text-muted)] px-5 py-2 border-t border-[var(--color-border)]">
                      {t('showingNOfM', { count: STAFF_VISIBLE, total: staff.length, defaultValue: `Showing ${STAFF_VISIBLE} of ${staff.length}` })}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

      </div>
    </DashboardLayout>
  );
}
