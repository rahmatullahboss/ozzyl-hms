import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, TrendingDown, DollarSign, RefreshCw, PieChart } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatCurrency } from '../../lib/format';

interface FinancialData {
  revenue: { total: number; byDepartment: { name: string; amount: number }[]; byPaymentMode: { name: string; amount: number }[] };
  expenses: { total: number; byCategory: { name: string; amount: number }[] };
  netIncome: number;
  grossMargin: number;
  outstandingDue: number;
  refundTotal: number;
  discountTotal: number;
  period: string;
}

const PERIODS = ['today', 'week', 'month', 'quarter', 'year'] as const;
type Period = (typeof PERIODS)[number];

export default function FinancialReports() {
  const { t } = useTranslation('adminPages');
  const [period, setPeriod] = useState<Period>('month');
  const { data, isLoading, refetch } = useApiQuery<FinancialData>(
    queryKeys.admin.executiveOverview(),
    `/api/admin/financial-reports?period=${period}`,
  );

  const revenue = data?.revenue;
  const expenses = data?.expenses;

  const fmt = (n: number | null | undefined) => formatCurrency(n ?? 0, { fractionDigits: 0 });

  const summaryCards = [
    { label: t('financialReports.summary.revenue'), value: fmt(revenue?.total ?? 0), color: 'text-emerald-600', icon: <TrendingUp className="w-4 h-4 text-emerald-500" /> },
    { label: t('financialReports.summary.expenses'), value: fmt(expenses?.total ?? 0), color: 'text-red-600', icon: <TrendingDown className="w-4 h-4 text-red-500" /> },
    { label: t('financialReports.summary.netIncome'), value: fmt(data?.netIncome ?? 0), color: (data?.netIncome ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600', icon: <DollarSign className="w-4 h-4 text-blue-500" /> },
    { label: t('financialReports.summary.grossMargin'), value: `${data?.grossMargin ?? 0}%`, color: 'text-purple-600', icon: <PieChart className="w-4 h-4 text-purple-500" /> },
    { label: t('financialReports.summary.outstandingDue'), value: fmt(data?.outstandingDue ?? 0), color: 'text-amber-600', icon: <DollarSign className="w-4 h-4 text-amber-500" /> },
    { label: t('financialReports.summary.refunds'), value: fmt(data?.refundTotal ?? 0), color: 'text-red-600', icon: <TrendingDown className="w-4 h-4 text-red-500" /> },
    { label: t('financialReports.summary.discounts'), value: fmt(data?.discountTotal ?? 0), color: 'text-orange-600', icon: <TrendingDown className="w-4 h-4 text-orange-500" /> },
  ];

  return (
    <DashboardLayout role="hospital_admin">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t('financialReports.title')}</h1>
            <p className="text-sm text-gray-500">{t('financialReports.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={period} onChange={e => setPeriod(e.target.value as Period)} className="input text-sm">
              {PERIODS.map(p => (
                <option key={p} value={p}>{t(`financialReports.periods.${p}`)}</option>
              ))}
            </select>
            <button
              onClick={() => refetch()}
              className="btn-ghost p-2"
              title={t('financialReports.refresh')}
              aria-label={t('financialReports.refresh')}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* P&L Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {summaryCards.map((card, i) => (
            <div key={i} className="card p-4">
              <div className="flex items-center gap-2 mb-1">{card.icon}<span className="text-xs text-gray-500">{card.label}</span></div>
              <p className={`text-lg font-bold ${card.color}`}>{card.value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Revenue by Department */}
          <div className="card p-5">
            <h3 className="font-semibold mb-4">{t('financialReports.revenueByDepartment')}</h3>
            {isLoading ? (
              <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="skeleton h-8 w-full rounded" />)}</div>
            ) : (
              <div className="space-y-3">
                {(revenue?.byDepartment ?? []).map((dept, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-sm">{dept.name}</span>
                    <div className="flex items-center gap-3">
                      <div className="w-32 bg-gray-200 rounded-full h-2">
                        <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${Math.min(100, (dept.amount / (revenue?.total ?? 1)) * 100)}%` }} />
                      </div>
                      <span className="text-sm font-medium w-20 text-right">{formatCurrency(dept.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Revenue by Payment Mode */}
          <div className="card p-5">
            <h3 className="font-semibold mb-4">{t('financialReports.revenueByPaymentMode')}</h3>
            {isLoading ? (
              <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="skeleton h-8 w-full rounded" />)}</div>
            ) : (
              <div className="space-y-3">
                {(revenue?.byPaymentMode ?? []).map((mode, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-sm">{mode.name}</span>
                    <div className="flex items-center gap-3">
                      <div className="w-32 bg-gray-200 rounded-full h-2">
                        <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${Math.min(100, (mode.amount / (revenue?.total ?? 1)) * 100)}%` }} />
                      </div>
                      <span className="text-sm font-medium w-20 text-right">{formatCurrency(mode.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Expenses by Category */}
          <div className="card p-5 lg:col-span-2">
            <h3 className="font-semibold mb-4">{t('financialReports.expensesByCategory')}</h3>
            {isLoading ? (
              <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="skeleton h-8 w-full rounded" />)}</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(expenses?.byCategory ?? []).map((cat, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-gray-50">
                    <span className="text-sm">{cat.name}</span>
                    <span className="text-sm font-medium">{formatCurrency(cat.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
