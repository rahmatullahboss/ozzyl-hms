import { Wallet, ChevronRight, AlertCircle } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../../hooks/useApiQuery';
import { queryKeys } from '../../../lib/queryKeys';
import { formatCurrency } from '../../../lib/format';
import { getTodayGMT6 } from '../../../lib/date-utils';

interface ActiveCounter {
  sessionId: number;
  counterName: string;
  operatorName: string;
  expectedCash: number;
  transactionCount?: number;
  openedAt: string;
}

interface ActiveCountersResponse {
  activeCounters: ActiveCounter[];
  totalActive: number;
}

interface CashControlResponse {
  totals?: {
    activeExpectedCash?: number;
    handoverCollected?: number;
    pendingHandoverAmount?: number;
    closedVariance?: number;
  };
}

export default function LiveCashDrawerWidget() {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const today = getTodayGMT6();

  const { data, isLoading, isError, refetch } = useApiQuery<ActiveCountersResponse>(
    queryKeys.admin.activeCounters(),
    '/api/dashboard/active-counters',
    { refetchInterval: 30000 },
  );

  const { data: cashControl } = useApiQuery<CashControlResponse>(
    ['admin-dashboard', 'cash-drawer-widget', today],
    `/api/dashboard/cash-control?date=${today}`,
    { refetchInterval: 30000 },
  );

  const activeCounters = data?.activeCounters ?? [];
  const fallbackExpectedCash = activeCounters.reduce((sum, counter) => sum + Number(counter.expectedCash || 0), 0);
  const expectedCash = Number(cashControl?.totals?.activeExpectedCash ?? fallbackExpectedCash);
  const handoverCollected = Number(cashControl?.totals?.handoverCollected ?? 0);
  const pendingHandover = Number(cashControl?.totals?.pendingHandoverAmount ?? 0);
  const closedVariance = Number(cashControl?.totals?.closedVariance ?? 0);

  if (isError) {
    return (
      <div className="card p-5" role="alert" aria-live="assertive">
        <div className="flex items-center gap-2 mb-3 text-red-700 dark:text-red-300">
          <AlertCircle className="w-4 h-4" />
          <p className="text-sm font-medium">{t('adminDashboard.errors.loadFailed')}</p>
        </div>
        <button
          onClick={() => refetch()}
          className="text-xs text-red-700 dark:text-red-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded"
        >
          {t('adminDashboard.errors.retry')}
        </button>
      </div>
    );
  }

  const summaryItems = [
    { label: 'Expected', value: expectedCash, tone: 'text-emerald-600' },
    { label: 'Handover', value: handoverCollected, tone: 'text-[var(--color-text-primary)]' },
    { label: 'Pending', value: pendingHandover, tone: 'text-amber-600' },
    { label: 'Variance', value: closedVariance, tone: closedVariance === 0 ? 'text-emerald-600' : 'text-red-600' },
  ];

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-emerald-500" />
          <h3 className="font-semibold text-[var(--color-text-primary)]">{t('adminDashboard.liveCashDrawers.title')}</h3>
        </div>
        <button
          onClick={() => navigate(`/h/${slug}/cash/drawers`)}
          className="text-xs text-[var(--color-primary)] hover:underline flex items-center gap-1"
        >
          {t('adminDashboard.liveCashDrawers.viewAll')} <ChevronRight className="w-3 h-3" />
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="skeleton h-10 w-full rounded-lg" />)}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {summaryItems.map((item) => (
              <div key={item.label} className="rounded-lg bg-[var(--color-bg-secondary)] p-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">{item.label}</p>
                <p className={`mt-1 font-data text-sm font-bold ${item.tone}`}>
                  {formatCurrency(item.value, { fractionDigits: 0 })}
                </p>
              </div>
            ))}
          </div>

          {!activeCounters.length ? (
            <p className="text-sm text-[var(--color-text-muted)] text-center py-4">{t('adminDashboard.liveCashDrawers.noActiveDrawers')}</p>
          ) : (
            <div className="space-y-2">
              {activeCounters.slice(0, 5).map(counter => (
                <button
                  key={counter.sessionId}
                  type="button"
                  onClick={() => navigate(`/h/${slug}/cash/drawers`)}
                  className="w-full flex items-center justify-between p-2.5 rounded-lg bg-[var(--color-bg-secondary)] hover:bg-[var(--color-border-light)] transition-colors text-left"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                      {counter.counterName}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)] truncate">
                      {counter.operatorName} · {(counter.transactionCount ?? 0).toLocaleString()} transactions
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-sm font-bold font-data text-emerald-600">{formatCurrency(counter.expectedCash, { fractionDigits: 0 })}</p>
                    <span className="inline-block mt-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-emerald-100 text-emerald-700">
                      {t('adminDashboard.liveCashDrawers.active')}
                    </span>
                  </div>
                </button>
              ))}
              {activeCounters.length > 5 && (
                <p className="text-xs text-[var(--color-text-muted)] text-center pt-1">
                  {t('adminDashboard.liveCashDrawers.moreCount', { count: activeCounters.length - 5 })}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
